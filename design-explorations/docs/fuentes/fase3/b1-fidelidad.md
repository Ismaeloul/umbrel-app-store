# B1 · Arquitectura de la app nativa «Palco» para iPhone (enfoque: fidelidad máxima)

> Fase 3 · propuesta de arquitectura. Solo diseño: no se ha tocado ningún fichero del repositorio.
> Fuentes leídas enteras: `a1-sistema.md` … `a9-servidor.md` (fase 3), el núcleo de `ace-player-neo/apps/ios`
> (`project.yml`, `Config/*`, `Sources/Core/**`, `Sources/Player/**`, `Sources/Features/Pairing/**`,
> `Sources/Debug/**`, `Tests/**`) y `.github/workflows/ios.yml` (con `solo_compilar` ya commiteado en `206a50d`).
>
> **Principio**: el píxel y la regla exacta de la web primero. Lo que no es nativo por decisión de Isma se
> hace propio para calcarlo; lo que Isma pidió nativo (Liquid Glass, hojas y menús del sistema, gestos,
> hápticos, AVPlayer…) se usa nativo, con el **contenido** de la web. Cuando un documento a1–a9 recomienda
> otra cosa que las decisiones 1–10 de Isma, **mandan las decisiones** (tabla §0.2).

---

## 0. Resumen y reglas de juego

### 0.1 En diez líneas

1. **Tres capas**: un paquete SwiftPM **puro** `AceNeoNucleo` (modelos, reglas portadas de la web, datos y algoritmos de la demo; solo Foundation, **compila y pasa tests en Linux con Docker en el PC de Isma**), el **núcleo Apple** (`Sources/Nucleo`: red, SSE, caché de consultas, Llavero, reproductor AVPlayer, PiP, sesión de fuentes) y la **interfaz** (`Sources/Palco`, `Sources/Armazon`, `Sources/Pantallas`).
2. **Ciclo de vida UIKit** (`AppDelegate` + `SceneDelegate` + `HostingRaiz: UIHostingController`) en vez de `App`/`WindowGroup`: controla el estilo de la barra de estado por zona (héroe, teatro), la orientación de ⛶, el indicador de inicio, los accesos rápidos y los enlaces `aceneo://`.
3. **Barra de pestañas propia** (la de la web) con `glassEffect` + píldora dorada que se desliza; pestañas vivas en un `ZStack`; **teatro en una capa propia** encima con transición «zoom» de elemento compartido propia (tarjeta → teatro) y gestos propios (borde izquierdo, vídeo abajo = minimizar, vídeo a los lados = otra fuente, doble toque = pantalla completa).
4. **Hojas y menús nativos** (`.sheet` con `presentationDetents`/asa, `.contextMenu` con vista previa, `Menu`) alimentados por **un único modelo de acciones** (`AccionMenu`) que también da las `accessibilityActions`.
5. **Tipografía por ejes** (Mona Sans variable `MonaSans-ExtraLight` + `wght`/`wdth` siempre fijados), tamaños fijos, alto de línea CSS calcado (caja 1,41 em corregida), cifras en celdas de 0,49/0,645 em.
6. **Tokens, iconos, plazos, textos y datos de demo GENERADOS desde el código de la web** con `--check` en la CI: si la web cambia, la app no compila en verde hasta regenerar.
7. **Reglas puras = funciones Swift puras con vectores** que produce el TypeScript de verdad (`tsx`), más los tests con estado (sesión de fuentes, avisos) portados a mano 1:1.
8. **Una sola `AVPlayerLayer`** (la `SuperficieVideo` actual) con huecos por prioridad: mini < portada < teatro < inmersivo.
9. **Servidor simulado = demo de la web** (`?demo=1`) con reloj fijado en los dos lados; capturas con los **mismos nombres** que `capturas/_revision/web-palco/final/` y comparación automática en la CI.
10. **Paralelizable**: una Fase 0 de contratos que compila con esqueletos, luego 8 agentes con carpeta exclusiva (+1 para el servidor 0.8.1) iterando con `solo_compilar`.

### 0.2 Donde los documentos a1–a9 decían otra cosa (manda Isma)

| Tema | a1–a8 recomendaban | Decisión de Isma | Qué hace esta arquitectura |
|---|---|---|---|
| Cristal | material + velo, **no** `glassEffect` (a1 §13.6, a2 §21.4) | Liquid Glass de verdad | `glassEffect(.regular.tint(token))` en todo lo que en la web es `.glass*`; con transparencia reducida, el color opaco exacto de la web (§B.7) |
| Hojas | hoja propia (a1 §10.18, a2 §21.7) | `.sheet` nativa con detents y asa | `HojaPalco` = `.sheet` + contenido y cabecera de la web (§C.6) |
| Menús | menú propio en el punto (a1 §10.19, a2 §21.8) | `.contextMenu` con vista previa y `Menu` | `AccionMenu` → `.contextMenu { } preview: { }` / `Menu` con `.menuOrder(.fixed)` (§C.7) |
| Transición al partido | capa viajera solo con escudos (a3 §4.8) | zoom/elemento compartido tarjeta → teatro | `TransicionTeatro` propia: la tarjeta entera crece hasta el teatro; los escudos viajan a la cabecera (§C.8) |
| Tirar para actualizar | no (a2 §21.10) | sí, en la agenda | `.refreshable` solo en la agenda |
| Tocar la pestaña activa | no hace nada (a2 §4.4) | sube arriba | `ScrollPosition.scrollTo(edge: .top)` sin háptica |
| Doble toque en el vídeo | nada (a4 §5.3) | pantalla completa | alterna vertical ↔ inmersivo |
| Deslizar el vídeo a los lados | no existe (solo en «Emitiendo») | cambia de fuente | mismo `stepSource` que «Emitiendo» (§D.6) |
| Cifras del marcador | sin animación salvo giro de paleta (a1 §3.5) | cifras que ruedan | giro de paleta al destapar (web) + `contentTransition(.numericText())` dentro de cada celda al cambiar (gol) |
| Icono de la app | variante oscura por defecto (a8 §7.4) | mismo icono que la app actual | `AppIcon` actual intacto (claro/oscuro/tintado); en la interfaz, la marca oscura de la web |
| iPad | pendiente (a8 §13) | app de iPhone | `TARGETED_DEVICE_FAMILY = "1"` |
| Fallos de la web | calcar o no, a decidir | no se copian | safeL en horizontal, menús con zona segura, hápticos cableados, cápsulas con color en transparencia reducida, menú del vídeo alcanzable en horizontal (§C.12) |

---

## A. Carpetas, ficheros y `project.yml`

### A.1 Árbol de `apps/ios` (nuevo)

```
apps/ios/
├─ project.yml                         (se reescribe, §A.3)
├─ Config/AceNeo.xcconfig              (se queda; MARKETING_VERSION = 0.8.1)
├─ Config/Info.plist                   (se queda con cambios, §A.4)
├─ Paquetes/AceNeoNucleo/              NUEVO · SwiftPM puro (Foundation), Linux-testable
│  ├─ Package.swift
│  ├─ Sources/AceNeoNucleo/
│  │  ├─ Modelos/        ← MUEVE Sources/Core/Models/* (sin cambios de API)
│  │  ├─ Dominio/        ← MUEVE Core/Dominio/{ParaTi,Canales}.swift (quitar nonisolated(unsafe))
│  │  ├─ Red/            ← MUEVE Endpoint.swift, Codificacion, SSEParser.swift, ErrorCatalog.swift (gen)
│  │  │                    NUEVO PlazosWeb.swift (gen), TextosCliente.swift
│  │  ├─ Reglas/         NUEVO · ports de la web (§E.5), una por fichero TS
│  │  ├─ Demo/           NUEVO · datos y algoritmos de la demo web (§F.2), puros
│  │  └─ Resources/Demo/*.json  (GENERADOS por scripts/generar-demo.mjs)
│  └─ Tests/AceNeoNucleoTests/ (+ Vectores/*.json GENERADOS)
├─ Sources/
│  ├─ App/                             AppDelegate, SceneDelegate, HostingRaiz, RaizView, CicloVida,
│  │                                   AccesoRapido, EnlacesEntrantes, MigracionClaves, Entorno (se queda)
│  ├─ Nucleo/                          núcleo Apple (se queda modernizado + nuevo)
│  │  ├─ Auth/        Llavero, Servidores (+PairingLink con varias u=), Emparejamiento      (se quedan)
│  │  ├─ Red/         APIClient (plazo total), APIError (textos web), Rutas, ServerResolver (se quedan)
│  │  │               SSEClient (esperas 3·2ⁿ), TiempoReal.swift (NUEVO)
│  │  ├─ Cache/       DiskCache, CacheImagenes (se quedan) · CacheConsultas.swift, Consulta.swift (NUEVOS)
│  │  ├─ Sesion/      SesionApp.swift (de AppModel), Arranque, Identidad, Reloj, Capacidades,
│  │  │               VigiaVersion, MarcadoresDestapados, SenalPartidos, EstadoAgendaCompartido (NUEVOS)
│  │  ├─ Reproduccion/ Reproductor, MotorVideo, MotorAVPlayer, MaquinaConexion, Directo,
│  │  │               ServicioReproduccion, ControlesSistema, SuperficieVideo (se quedan, §D)
│  │  │               SesionFuentes.swift (REESCRITO, port de session.ts), PresentacionReproductor.swift
│  │  ├─ Avisos/      Avisos.swift (port de notices/*), Haptica.swift (NUEVOS)
│  │  └─ Emparejar/   ModeloEmparejar (de PairingViewModel), QRScannerView (se queda)
│  ├─ Palco/                           sistema de diseño (NUEVO, §B)
│  │  ├─ Tokens/      TokensGenerados.swift (gen), ColorDinamico, Fuente (Mona/Martian), EstiloTexto,
│  │  │               Medidas, Sombras, Movimiento, Cristal
│  │  ├─ Iconos/      IconosGenerados.swift (gen), IconoPalco, IconoImagen
│  │  ├─ Componentes/ una vista por primitiva de apps/web/src/ui (§B.9)
│  │  └─ Galeria/     SistemaView (a1 §11)
│  ├─ Armazon/                         (NUEVO, §C)  Ruta, Navegador, Maquetacion, Shell, PestanasVivas,
│  │                                   BarraPestanas, BarraSuperior, VeloInferior, CapaAvisos,
│  │                                   CabeceraVista, HojaPalco, AccionMenu, TransicionTeatro,
│  │                                   BordeAtras, SubeConLaBarra, EstadosGlobales
│  ├─ Pantallas/                       (NUEVO)
│  │  ├─ Emparejar/  Agenda/  Partido/  Reproductor/  Canales/  Buscar/  Pegar/  Ajustes/
│  └─ Debug/                           (#if DEBUG) ServidorSimulado (URLProtocol → Demo del paquete),
│                                      MotorSimulado, ImagenDemo (campo de fútbol de la web)
├─ Resources/
│  ├─ Assets.xcassets/  AppIcon (INTACTO), Bg, AccentColor, Marca (una variante: la oscura de la web),
│  │                    atajo-agenda, atajo-canales (plantillas GENERADAS desde icons.ts)
│  └─ Fuentes/  MonaSans-Variable.ttf, MartianMono-Variable.ttf, OFL.txt, ORIGEN.json (sha de los woff2)
├─ Tests/
│  ├─ AceNeoTests/    se quedan los del núcleo (§A.2) + nuevos (Reproduccion, TiempoReal, Consultas, Palco)
│  └─ AceNeoUITests/  REESCRITOS: Ayudas/ (se quedan AyudasUI, ServidorDePruebas, sePinta),
│                     Flujos/<Pantalla>UITests.swift, CapturasPalcoUITests.swift, ServidorRealUITests.swift
└─ scripts/
   ├─ generar-tokens.mjs      tokens.css (bloques hex claro/oscuro) → TokensGenerados.swift
   ├─ generar-iconos.mjs      ui/icons.ts → IconosGenerados.swift + 2 plantillas de atajo
   ├─ generar-plazos.mjs      api/client.ts TIMEOUTS + session.ts RESOLVE/RESEARCH → PlazosWeb.swift
   ├─ generar-vectores.mjs    (AMPLIADO, con tsx) reglas web → Vectores/*.json
   ├─ generar-demo.mjs        (con tsx) demo web → Resources/Demo/*.json + vectores-demo.json
   ├─ generar-textos.mjs      literales de notify/toast/mensajes → Vectores/textos-web.json
   ├─ generar-catalogo-errores.mjs, generar-recursos.mjs (lee apps/web/public/icon.svg), build-ipa.sh,
   │  pila-e2e.mjs            (se quedan)
   ├─ generar-fuentes.py      woff2 → TTF (fontTools+brotli, una vez; la CI solo comprueba ORIGEN.json)
   ├─ revisar-swift.mjs       NUEVO · lint de patrones prohibidos (§G.5), segundos
   └─ comparar-capturas.py    NUEVO · web ↔ simulador (Pillow), informe HTML
```

### A.2 Qué se borra, qué se queda

**Se borra** (≈ 7 900 líneas, a8 §4): `Sources/App/RootView.swift`; `Sources/Design/**` entero; `Sources/Features/**` salvo lo rescatado abajo; `Player/ReproductorVistas.swift`; los números de `Player/GestosReproductor.swift` (la forma pasa a `Reglas/Gestos.swift` con los de la web); `Resources/Assets.xcassets/Colores/*` salvo `Bg`; `Marca` claro; todos los flujos de `Tests/AceNeoUITests` (se quedan las ayudas y el E2E); tests de reglas del prototipo (`ColoresVersusTests`, `ChipHoraTests`, `CapsulaSenalTests`, `SeccionesAgendaTests`, `GestosReproductorTests`).

**Se rescata antes de borrar** → a su sitio nuevo: `AgendaViewModel`/`RelojMadrid` (→ revalidados en `Reglas/Agenda.swift`), `ReglasFuentes` (→ `Reglas/Fuentes.swift`), `CentroPartidoModelo` (→ base de `SesionFuentes`), `HermanasModelo`, `BuscarModelo`, `DondeSuena`, `GustosEditables`/`TipoGusto`, `Apariencia` (solo para migrar claves), `DisposicionFlujo` (→ `FlujoLayout`).

**Se queda (tests)**: `APIClientTests`, `EndpointTests`, `SSEParserTests`, `SSEClientTests` (números nuevos), `LlaveroTests`, `EmparejamientoTests` (+ QR con varias `u=`), `FixturesTests`, `InfoPlistTests` (+ `UIAppFonts`, familia 1), `CacheTests`, `CacheImagenesTests`, `CatalogoErroresTests` (textos nuevos), `MaquinaYDirectoTests` (visor nuevo), `MotorAVPlayerTests`, `ReproductorTests`, `SuperficieUnicaTests`, `PiPTests`, `SistemaTests` (Now Playing nuevo), `VectoresDominioTests` (→ paquete), `ReglasFuentesTests`, `ResumenFuentesTests`, `EscudosDecodificacionTests`.

### A.3 `project.yml`

```yaml
name: AceNeo
options:
  bundleIdPrefix: es.ismaeloul
  deploymentTarget: { iOS: "26.0" }
  developmentLanguage: es
  createIntermediateGroups: true
  groupSortPosition: top
  generateEmptyDirectories: false
configFiles: { Debug: Config/AceNeo.xcconfig, Release: Config/AceNeo.xcconfig }

packages:
  AceNeoNucleo:
    path: Paquetes/AceNeoNucleo

settings:
  base:
    SWIFT_VERSION: "6.0"                 # modo de lenguaje 6 (compilador 6.2 de Xcode 26.6); concurrencia estricta implícita
    IPHONEOS_DEPLOYMENT_TARGET: "26.0"
    TARGETED_DEVICE_FAMILY: "1"          # solo iPhone
    ENABLE_USER_SCRIPT_SANDBOXING: YES
    LOCALIZATION_PREFERS_STRING_CATALOGS: YES
    DEAD_CODE_STRIPPING: YES
    CODE_SIGN_STYLE: Automatic
    DEVELOPMENT_TEAM: ""
    # SIN SWIFT_DEFAULT_ACTOR_ISOLATION ni SWIFT_APPROACHABLE_CONCURRENCY: se anota @MainActor a mano
    # (ver §G.5: @Entry y Codable con aislamiento por defecto dieron errores difíciles de ver sin Xcode).
  configs:
    Debug:
      SWIFT_OPTIMIZATION_LEVEL: "-Onone"
      OTHER_SWIFT_FLAGS: "$(inherited) -Xfrontend -warn-long-expression-type-checking=150 -Xfrontend -warn-long-function-bodies=300"
    Release:
      SWIFT_OPTIMIZATION_LEVEL: "-O"
      SWIFT_COMPILATION_MODE: wholemodule

targets:
  AceNeo:
    type: application
    platform: iOS
    sources:
      - path: Sources
      - path: Resources
    dependencies:
      - package: AceNeoNucleo
    settings:
      base:
        PRODUCT_NAME: AceNeo
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID)          # es.ismaeloul.aceplayerneo, igual que hoy
        INFOPLIST_FILE: Config/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: AccentColor
        ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS: YES
        ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS: YES
        ENABLE_PREVIEWS: YES
        SUPPORTS_MACCATALYST: NO
        SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: NO
  AceNeoTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - path: Tests/AceNeoTests
      - path: ../../packages/shared/fixtures
        type: folder
        buildPhase: resources
    dependencies: [ { target: AceNeo }, { package: AceNeoNucleo } ]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID).tests
        GENERATE_INFOPLIST_FILE: YES
        TEST_HOST: $(BUILT_PRODUCTS_DIR)/AceNeo.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/AceNeo
        BUNDLE_LOADER: $(TEST_HOST)
  AceNeoUITests:
    type: bundle.ui-testing
    platform: iOS
    sources: [ { path: Tests/AceNeoUITests } ]
    dependencies: [ { target: AceNeo } ]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID).uitests
        GENERATE_INFOPLIST_FILE: YES
        TEST_TARGET_NAME: AceNeo
schemes:
  AceNeo:
    build: { targets: { AceNeo: all, AceNeoTests: [test], AceNeoUITests: [test] } }
    run: { config: Debug }
    test:
      config: Debug
      gatherCoverageData: true
      coverageTargets: [AceNeo]
      targets:
        - { name: AceNeoTests, parallelizable: false }
        - { name: AceNeoUITests, parallelizable: false }
    profile: { config: Release }
    archive: { config: Release }
```

`Paquetes/AceNeoNucleo/Package.swift`:

```swift
// swift-tools-version: 6.2
import PackageDescription
let package = Package(
    name: "AceNeoNucleo",
    platforms: [.iOS(.v26), .macOS(.v15)],          // macOS para `swift test` en el runner; Linux ignora platforms
    products: [.library(name: "AceNeoNucleo", targets: ["AceNeoNucleo"])],
    targets: [
        .target(name: "AceNeoNucleo", resources: [.copy("Resources/Demo")],
                swiftSettings: [.swiftLanguageMode(.v6)]),
        .testTarget(name: "AceNeoNucleoTests", dependencies: ["AceNeoNucleo"],
                    resources: [.copy("Vectores")]),
    ]
)
```

Reglas del paquete: **solo Foundation** (nada de `CryptoKit`, `UIKit`, `os`, `OSAllocatedUnfairLock`; para exclusión mutua, `Mutex` de `Synchronization`, que existe en Linux). Así se prueba en el PC: `docker run --rm -v "$PWD/Paquetes/AceNeoNucleo:/p" -w /p swift:6.2-noble swift test` (instalar `tzdata` en la imagen si `Europe/Madrid` no resuelve).

### A.4 `Info.plist` (cambios sobre el actual)

| Clave | Valor |
|---|---|
| `CFBundleDisplayName` | `$(ACE_DISPLAY_NAME)` = «Ace Neo» (igual que hoy) |
| `UIAppFonts` | `["Fuentes/MonaSans-Variable.ttf", "Fuentes/MartianMono-Variable.ttf"]` |
| `UIBackgroundModes` | `["audio"]` (se queda) |
| `CFBundleURLTypes` | esquema `aceneo` (se queda, `$(PRODUCT_BUNDLE_IDENTIFIER).emparejar`) |
| `UIApplicationSceneManifest` | una escena, `UISceneDelegateClassName = $(PRODUCT_MODULE_NAME).SceneDelegate`, sin storyboard |
| `UIApplicationShortcutItems` | «Agenda de fútbol» (`atajo-agenda`) y «Canales» (`atajo-canales`) (a2 §25) |
| `UISupportedInterfaceOrientations` | vertical + horizontal izquierda/derecha; **se quita `~ipad`** |
| `UIViewControllerBasedStatusBarAppearance` | `YES` (la controla `HostingRaiz`) |
| `UILaunchScreen.UIColorName` | `Bg` |
| `NSCameraUsageDescription`, `NSLocalNetworkUsageDescription`, ATS con `NSAllowsLocalNetworking` y excepciones `ts.net`/CIDR | se quedan |
| `LSApplicationQueriesSchemes` | `["acestream"]` («Abrir en la app de AceStream» con `canOpenURL`) |

---

## B. Sistema de diseño (`Sources/Palco`)

### B.1 Color: Swift estático GENERADO desde `tokens.css`

- `scripts/generar-tokens.mjs` lee `apps/web/src/styles/tokens.css`: **claro** = bloque hex de `:root` (coincide con el OKLCH redondeado), **oscuro** = bloque `:root[data-scheme='dark']` (el que gana por especificidad, a1 §0.1). Escribe `TokensGenerados.swift`; `--check` en la CI. Nada de colorsets salvo `Bg` (pantalla de arranque) y `AccentColor`.
- sRGB, no P3 (las referencias son sRGB, a1 §2.6).

```swift
// Palco/Tokens/ColorDinamico.swift
extension Color {
    /// Color que resuelve claro/oscuro por el esquema del SUBÁRBOL (islas oscuras incluidas).
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1)
    init(hex: UInt32, alfa: Double = 1)
}
// Palco/Tokens/TokensGenerados.swift  (GENERADO, no editar)
enum Palco {
    static let bg          = Color(claro: 0xF3F3F4, oscuro: 0x05070A)
    static let bgSunk      = Color(claro: 0xE9E9EB, oscuro: 0x020305)
    static let surface     = Color(claro: 0xFFFFFF, oscuro: 0x0F1218)
    static let surface2    = Color(claro: 0xECECEE, oscuro: 0x171B23)
    static let line        = Color(claro: 0xD9D9DC, oscuro: 0x282A2C)
    static let lineSoft    = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF, alfaClaro: 0.08, alfaOscuro: 0.10)
    static let lineStrong  = Color(claro: 0x83858C, oscuro: 0x696A6C)
    static let text / text2 / text3 / accent / onAccent / accentInk / accentEdge / accentWash
    static let live / liveInk / ok / okInk / weak / weakInk / fail / failInk
    static let glass / glassDense / glassSolid / glassHi / glassRim / scrim
    // fijos
    static let glassVideo = Color(hex: 0x0A0C10, alfa: 0.62)
    static let glassVideoSolid = Color(hex: 0x0F1218)
    static let onVideo = Color.white, onVideo2 = Color(hex: 0xFFFFFF, alfa: 0.76)
    static let veil = Color(hex: 0x000000, alfa: 0.55), veilStrong = Color(hex: 0x000000, alfa: 0.85)
}
// Mezclas precalculadas (a1 §2.3, a6 §0.1, a4 §1): GENERADAS por el mismo script con OKLab.
enum PalcoMezcla {
    static let liveCapsula = Color(claro: 0xB1231A, oscuro: 0xD12E25)  // mix(live 86 %, #000)
    static let capsulaOk/Weak/Fail, halos, «Ninguna da señal» (#FDEEEC/#22191D), «Hash detectado» (#D6DEDA/#05100C)…
}
```

- **Regiones siempre oscuras** (a1 §0.2): modificador `.islaOscura()` = `.environment(\.colorScheme, .dark)`. Lo llevan: tarjeta versus entera, cabecera sobre el héroe, tarjeta de primer uso, pastilla de competición, cartel de canal, todo lo que va sobre el vídeo (controles, cápsulas, panel de mensaje, cápsula de estado), cartel de la cámara de emparejar.
- **Colores de equipo y canal**: `Reglas/Color.swift` + `Reglas/Equipos.swift` (port 1:1 de `lib/color.ts`/`lib/teams.ts`: `hashText` FNV-1a UTF-16, `hueFromName` 52 tonos, `channelTone`, `nameTone`, `teamLight`, `versusPair` ΔE < 0,14, `teamInitials`, `competitionShort`, `channelDorsal`, `channelAbbrev`) → devuelven `RGB` (en el paquete); la interfaz los convierte a `Color`.

### B.2 Tipografía

**Fábrica única** (a1 §3.7, a2 §21.3): PostScript `MonaSans-ExtraLight` + `kCTFontVariationAttribute` con **los dos ejes siempre**; Martian Mono `MartianMono-SemiExpandedRegular` (wdth 87,5).

```swift
// Palco/Tokens/Fuente.swift
enum EjeFuente { static let wdth = 0x7764_7468, wght = 0x7767_6874 }

@MainActor
enum Mona {
    static func ctFont(_ tamano: CGFloat, wght: CGFloat, wdth: CGFloat = 100) -> CTFont   // caché por clave
    static func uiFont(_ tamano: CGFloat, wght: CGFloat, wdth: CGFloat = 100) -> UIFont   // para UILabel
    static func font(_ tamano: CGFloat, wght: CGFloat, wdth: CGFloat = 100) -> Font
}
@MainActor enum Martian { static func font(_ tamano: CGFloat, wght: CGFloat = 400, wdth: CGFloat = 87.5) -> Font }
```

**Estilos como datos** (no `static let Font`, que choca con el aislamiento):

```swift
// Palco/Tokens/EstiloTexto.swift
struct EstiloTexto: Hashable, Sendable {
    var tamano: CGFloat; var peso: CGFloat; var anchura: CGFloat = 100
    var trackingEm: CGFloat = 0; var altoLinea: CGFloat          // lh CSS (1,1 · 1,25 · 1,45 · o absoluto/tamano)
    var mayusculas = false; var mono = false
    static let titularVista   = EstiloTexto(tamano: 30, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)
    static let titularVista44 = EstiloTexto(tamano: 44, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)
    static let tituloHoja     = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25)
    static let cuerpo         = EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.45)
    static let kicker         = EstiloTexto(tamano: 13, peso: 700, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true)
    static let boton / botonSm / chip / capsula / capsulaSm / segmento / menu / toast / campo(16) / pestana(11·620·88) …
    static func cifras(_ tamano: CGFloat) -> EstiloTexto   // 780 · 75
}
extension View {
    /// Fuente + tracking (em × tamaño) + alto de línea CSS en UNA línea: padding vertical (lh − 1,41)·t/2.
    func estilo(_ e: EstiloTexto) -> some View
}
/// Varias líneas con lh < 1,41 (título del vacío, toasts de dos líneas, «Personaliza tu agenda»…):
/// UILabel con NSParagraphStyle min/maxLineHeight = lh·t y baselineOffset (lh − 1,41)·t/2 (a1 §13.3).
struct TextoMultilinea: UIViewRepresentable { init(_ texto: String, estilo: EstiloTexto, color: UIColor, lineas: Int = 0, alineacion: NSTextAlignment = .natural) }
```

- **Métrica base**: ascendente 1090, descendente 320 → caja natural 1,41 em; tabla de correcciones de a3 §1.4.1 como test (`EstiloTextoTests` mide `Text` en un `UIHostingController` y compara la altura con `lh × t`).
- **Cifras `Num`**: `NumeroPalco(_ texto: String, estilo: EstiloTexto, condensado: Bool = true, etiqueta: String?)` → `HStack(spacing: 0, alignment: .firstTextBaseline)` de segmentos de `Reglas/Numeros.splitDigits` (port de `ui/Num.tsx`); cada cifra en `frame(width: 0.49·t)` (0,645 sin condensar; 0,72 en el código de emparejar); separadores a su ancho; `.accessibilityElement(children: .ignore).accessibilityLabel(etiqueta ?? texto)`. **Prohibidos** `.monospacedDigit()` y `.fontWeight/.bold/.fontWidth` sobre fuentes Palco.
- **Dynamic Type**: tamaños fijos (como Safari con la web). Raíz con `.estilo(.cuerpo)` para que ningún `Text` caiga en `.body`; `.accessibilityShowsLargeContentViewer()` en pestañas, destinos de la barra superior, controles del vídeo, `BotonIcono` y cápsulas (a2 §26). `revisar-swift.mjs` rechaza `.font(.body`, `Font.custom(`, `@ScaledMetric`.
- **Test obligatorio** (a2 §21.3): `CTFontCopyPostScriptName == "MonaSans-ExtraLight"` y `CTFontCopyVariation` con `{wght: 800, wdth: 125}`.
- Fuentes: TTF convertidos del **mismo woff2** que carga la web (`@fontsource-variable/mona-sans@5.3.0 …-wdth-normal.woff2`), `scripts/generar-fuentes.py` (fontTools + brotli, ya probado en el PC). La CI comprueba con Node que el sha-256 del woff2 del `node_modules` coincide con `Resources/Fuentes/ORIGEN.json` (si la web sube de versión, falla y avisa de regenerar).

### B.3 Iconos: 52 `Shape` generados desde `icons.ts`

- `scripts/generar-iconos.mjs` importa `apps/web/src/ui/icons.ts`, normaliza cada icono en **trazo** y **relleno** (a1 §12: `rect` con radio → arcos, `circle` → dos arcos), pasa comandos relativos a absolutos y **arcos SVG → cúbicas** (tramos ≤ 90°), y escribe:

```swift
// Palco/Iconos/IconosGenerados.swift (GENERADO)
enum NombreIcono: String, CaseIterable, Sendable { case agenda, biblioteca, buscar, ajustes, play, pause, stop, vol, mute, back, full, pip, more, star, starF = "star-f", copy, paste, flag, refresh, check, learn, chevD = "chev-d", chevU = "chev-u", chevL = "chev-l", chevR = "chev-r", tv, motor, nerd, hash, link, plus, list, clock, eye, eyeOff = "eye-off", panel, x, pencil, trash, kbd, sol, luna, pantalla, movil, qr, externo, info, aviso, ayuda, senal, directo, subir }
extension NombreIcono {
    func trazo(en rect: CGRect) -> Path      // coordenadas 24 × 24 escaladas
    func relleno(en rect: CGRect) -> Path    // piezas stroke="none"
}
```

```swift
// Palco/Iconos/IconoPalco.swift
struct IconoPalco: View {
    init(_ nombre: NombreIcono, tamano: CGFloat = 24, relleno: Bool = false)
    // cuerpo: ZStack { if relleno { FormaIcono(trazo).fill() }; FormaIcono(trazo).stroke(1,8·t/24, round, round); FormaIcono(relleno).fill() }
}
// Palco/Iconos/IconoImagen.swift — para Menu/contextMenu (solo aceptan Image): ImageRenderer a escala 3,
// plantilla, caché por (nombre, tamaño, relleno).
@MainActor enum IconoImagen { static func imagen(_ nombre: NombreIcono, tamano: CGFloat = 20) -> Image }
```

- `relleno: true` (relleno + trazo, a1 §10.1) solo en: pausa/reproducir de 52, mini (`tv`, `pause`/`play`, `stop`), «Toca para reproducir» (32).
- El mismo script escribe `atajo-agenda.svg` y `atajo-canales.svg` (plantillas con «Preserve Vector Data») para los accesos rápidos.
- Test: `NombreIcono.allCases.count == ICON_NAMES.length` (el número sale del JSON que escribe el script).
- `symbolEffect` no aplica (no hay SF Symbols); las animaciones de iconos (giro de ⟳ 900 ms, ecualizador) van con `PhaseAnimator`/`TimelineView`.

### B.4 Espacios, radios, capas, zonas táctiles

```swift
// Palco/Tokens/Medidas.swift (GENERADO en parte)
enum S { static let s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s5 = 20.0, s6 = 24.0, s8 = 32.0, s10 = 40.0, s12 = 48.0, gutter = 16.0, tap = 44.0 }
enum R { static let xl = 24.0, l = 18.0, m = 14.0, s = 10.0, xs = 6.0; static func interior(_ exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(6, exterior - relleno) } }
enum Z { static let sticky = 20.0, velo = 39.0, barra = 40.0, mini = 41.0, avisos = 60.0, inmersivo = 100.0 }  // hojas y menús: del sistema
enum Alturas { static let tabbar = 64.0, tabbarGap = 10.0, topbar = 64.0, mini = 72.0 }             // --mini-h = 72 (a1 §4.3)
```

- Formas **circulares**: `.rect(cornerRadius: r, style: .circular)` (nunca `.continuous`).
- Zona táctil ≥ 44 sin agrandar el dibujo: `.contentShape(.rect.inset(by: -n))`.

### B.5 Sombras (incluidas las de extensión negativa)

```swift
// Palco/Tokens/Sombras.swift
enum TipoSombra { case uno, dos, cartel, cartelCanal, escudo, primario, gota, pastilla, cristalVideo, pulgar, textoCartel, hojaArriba }
extension View {
    /// Cada capa CSS = una capa SwiftUI. Extensión negativa e: forma encogida |e| por lado, .blur(radius: B/2), offset.
    func sombra(_ tipo: TipoSombra, forma: some Shape) -> some View
}
```

- `0 20 60 -20 c` → `forma.fill(c).padding(20).offset(y: 20).blur(radius: 30)` detrás (a2 §21.5). `inset 0 1 0 c` → `forma.subtracting(forma.offset(y: 1)).fill(c)`; `inset 0 0 0 1 c` → `strokeBorder(c, 1)`; borde izquierdo de 3 de la línea de estado → `forma.subtracting(forma.offset(x: 3))`.
- Las sombras de las islas oscuras son siempre las oscuras (se resuelven dentro de `.islaOscura()`).

### B.6 Movimiento (tabla web → SwiftUI)

| Token web | CSS | SwiftUI | Reducido |
|---|---|---|---|
| rápido | `linear()` 340 ms | `.spring(duration: 0.25, bounce: 0)` | `.easeOut(duration: 0.12)` |
| estándar | 520 ms | `.spring(duration: 0.4, bounce: 0.15)` | `.easeOut(duration: 0.15)` |
| héroe | 800 ms | `.spring(duration: 0.55, bounce: 0.3)` | `.easeOut(duration: 0.15)` |
| progreso (héroe + curva estándar) | 800 ms | `.spring(duration: 0.615, bounce: 0.15)` | `.easeOut(duration: 0.15)` |
| salida / fundido | `cubic-bezier(.2,.7,.3,1)` 320 ms | `.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)` | igual |
| transición de vista | 340 ms ease-out, ±16 | `.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.34)` | 0,12 s, solo opacidad |
| escalonado | 36 ms × min(i, 10) | `.delay(Double(min(i, 10)) * 0.036)` | sin retraso |
| latidos | 2 s, onda al 70 % | `TimelineView(.animation)` con `t = fmod(ahora, 2)/2` (todas en fase, como la web) | no se pintan |
| soltar un gesto (nativo) | — | `.interpolatingSpring(Spring(duration: 0.4, bounce: 0.15), initialVelocity: v)` | 0,12 s |

```swift
// Palco/Tokens/Movimiento.swift
enum Movimiento {
    static func rapido(_ r: Bool) -> Animation; static func estandar(_ r: Bool) -> Animation
    static func heroe(_ r: Bool) -> Animation;  static let progreso: Animation; static let salida: Animation
    static func vista(_ r: Bool) -> Animation;  static func soltar(velocidad: CGFloat, _ r: Bool) -> Animation
}
// Entorno: @Entry var movimientoReducido: Bool  (= accessibilityReduceMotion; en vistas, hojas y emparejar
// también accessibilityPrefersCrossFadeTransitions, a2 §26)
```

- Solo se animan posición, escala y opacidad; los colores cambian al instante (`.animation(nil, value:)`).
- `.press` → `PulsarStyle: ButtonStyle` (escala 0,975 + velo `currentColor` 10 %, muelle rápido).
- Giro de paleta de cifras: `rotation3DEffect(.degrees(−90 → 0), axis: (1, 0, 0), perspective: 240/altura)` + opacidad con `Movimiento.heroe`; rebote de gol `keyframeAnimator` escala 1 → 1,14 (35 % de 0,72 s) → 1. Cambio de valor (añadido nativo): `contentTransition(.numericText())` dentro de cada celda.

### B.7 Cristal: `glassEffect` con los tintes de la web

```swift
// Palco/Tokens/Cristal.swift
enum TipoCristal: Sendable { case regular, denso, video, botonCristal, botonVideo, capsulaVideo }
extension View {
    /// Liquid Glass con el tinte del token; con transparencia reducida (sistema O ajuste «aceneo-transparencia»),
    /// el color opaco EXACTO de la web y sin efecto.
    func cristal(_ tipo: TipoCristal, en forma: some Shape, interactivo: Bool = false) -> some View
}
@Entry var cristalOpaco: Bool   // = accessibilityReduceTransparency || ajuste == "reducida"  (se calcula en la raíz)
```

| Elemento web | `tipo` | `glassEffect` | Opaco (reducido) |
|---|---|---|---|
| Barra inferior, mini, toasts (`glass--dense`) | `.denso` | `.regular.tint(TinteCristal.denso)` en `GlassEffectContainer` | `glassSolid` `#FAFAFB`/`#12161D` |
| Barra superior horizontal (`glass`) | `.regular` | `.regular.tint(TinteCristal.regular)`; capa `glassDense` + filete al pasar 32 pt | `glassSolid` |
| Cápsulas y círculo sobre vídeo, cápsula de estado, cápsula de la cámara (`glass--video`) | `.video` | `.regular.tint(TinteCristal.video).interactive()` dentro de `.islaOscura()`, un `GlassEffectContainer(spacing: 8)` por fila de controles | `glassVideoSolid` `#0F1218` |
| Cápsulas de cristal en carteles (`capsule--glass`) | `.capsulaVideo` | `.regular.tint(TinteCristal.video)`; **directo y oro conservan su fondo** (#D12E25 / #FFD60A) | `#0F1218`, **salvo directo y oro, que siguen en rojo/oro** (fallo §0.7 de la web no se copia) |
| `btn--video` (panel del vídeo) | `.botonVideo` | `.regular.tint(white 0.16)` | `#0F1218` |
| Hojas (`glass-solid`, opacas en la web) | — | `.presentationBackground(Palco.glassSolid)` | igual |
| Menús | — | los del sistema (cristal de iOS) | los del sistema |

- `TinteCristal` son **constantes calibradas** (empiezan en el alfa de la web: 0,90 / 0,72 / 0,62 y se ajustan una vez con capturas lado a lado; el cristal es la única diferencia visual aceptada por decisión).
- El borde 1 px `glassRim` y el brillo `glassHi` de la web **no** se superponen al Liquid Glass (tiene su propio borde especular); sí en el modo opaco.
- Rendimiento: carruseles con muchas cápsulas de cristal → un `GlassEffectContainer` por tarjeta; si en el iPhone se ve tirón al desplazar, plan B documentado: `.capsulaVideo` con `Material` + tinte (§H).

### B.8 Háptica: `HAPTIC_MAP` → `sensoryFeedback`

Un único disparador central (anti-ráfaga de 40 ms por tipo, `selection` silenciada con Reducir movimiento, nunca única señal) y **un solo `.sensoryFeedback` en la raíz** (y otro en `HojaPalco`, porque las hojas se pintan en otra jerarquía):

```swift
// Nucleo/Avisos/Haptica.swift
enum TipoHaptica: Sendable, Hashable { case selection, light, medium, heavy, rigid, success, warning, error }
struct PulsoHaptico: Equatable, Sendable { let n: Int; let tipo: TipoHaptica }
@MainActor @Observable final class Haptica {
    private(set) var pulso = PulsoHaptico(n: 0, tipo: .selection)
    var movimientoReducido = false
    func disparar(_ tipo: TipoHaptica)          // aplica las reglas y sube `pulso`
}
extension TipoHaptica { var feedback: SensoryFeedback { /* .selection, .impact(weight: .light) …, .impact(flexibility: .rigid), .success, .warning, .error */ } }
// Raíz (tipos escritos, §G.5):
// .sensoryFeedback(trigger: haptica.pulso) { (_: PulsoHaptico, nuevo: PulsoHaptico) -> SensoryFeedback? in nuevo.tipo.feedback }
```

| Tipo | Sitios (tabla única de a1 §8.1; «+» = añadido nativo) |
|---|---|
| `selection` | cambiar de destino en la barra (+, no al tocar el activo) · día (tira o gesto) · Para ti/Todos · Favoritos/Recientes/Listas · pestañas del teatro · chips de gustos y «Añadir» · índice de Ajustes · modo · «Un solo dispositivo» · tema · «Reducir transparencia» |
| `light` | abrir partido (héroe/fila; no sin canal) · destapar/tapar marcador · cartel de canal y fila de canal (+) · pausa/reproducir · silencio · minimizar (botón, gesto, borde +) · abrir el mini deslizando arriba |
| `medium` | ⛶ / doble toque (+) · cerrar hoja arrastrando (+) · pulsación larga: **la pone el sistema** con `.contextMenu` (no se duplica) |
| `heavy` | cruzar el umbral lateral (72) del mini, una vez por cruce |
| `rigid` | elegir fuente (cartel) · ‹ › y deslizar en «Emitiendo» · deslizar el vídeo a los lados (+) · detener · zapping |
| `success` | gol con marcador visto · fuente reportada · hash pegado · favorito guardado · guardar gustos · emparejado (web y QR +) |
| `warning` | cambio automático de fuente · acceso perdido/revocado · olvidar este iPhone (al acabar) |
| `error` | fuente elegida a mano que falla · código de emparejamiento inválido / QR ajeno (+) |

### B.9 Primitivas (`Palco/Componentes`, una por fichero; firmas fijadas en la Fase 0)

```swift
struct BotonPalco: View { init(_ titulo: String, icono: NombreIcono? = nil, iconoFinal: NombreIcono? = nil, variante: VarianteBoton = .quiet, tamano: TamanoBoton = .md, bloque: Bool = false, pulsado: Bool? = nil, ocupado: Bool = false, accion: @escaping () -> Void) }
enum VarianteBoton { case primary, quiet, ghost, glass, video, danger }
struct BotonIcono: View { init(_ icono: NombreIcono, etiqueta: String, variante: VarianteBotonIcono = .ghost, grande: Bool = false, pulsado: Bool? = nil, iconoPulsado: NombreIcono? = nil, relleno: Bool = false, ocupado: Bool = false, accion: @escaping () -> Void) }
struct Chip: View { init(_ texto: String, icono: NombreIcono? = nil, contador: Int? = nil, tono: TonoChip = .soft, contorno: ContornoChip? = nil, pulsado: Bool? = nil, accion: (() -> Void)? = nil) }
struct Capsula: View { init(_ texto: String, tono: TonoCapsula = .neutral, tamano: TamanoCapsula = .md, punto: Bool = false, icono: NombreIcono? = nil, cristal: Bool = false, pulsado: Bool? = nil, accion: (() -> Void)? = nil) }
struct MedidorSenal: View { init(_ estado: EstadoSenal, tamano: TamanoMedidor = .md, palabra: String? = nil, ocultarPalabra: Bool = false, apilado: Bool = false, compacto: Bool = false) }   // SignalBadge
struct AnilloSenal: View { init(_ estado: EstadoAnillo, tamano: CGFloat = 28, palabra: String? = nil) }                                  // SignalRing
struct PuntoDirecto: View { init(etiqueta: String? = nil) }                                                                           // LiveDot
struct BarraProgreso: View { init(valor: Double, fina: Bool = false, tono: TonoProgreso = .accent, muescas: [Double] = [], etiqueta: String) }
struct MarcaEquipo: View { init(_ lado: LadoEquipo, tamano: CGFloat = 28, encendido: Bool = false, patron: PatronEquipo = .liso) }        // TeamMark
struct MarcaCanal: View { init(nombre: String, forma: FormaMarcaCanal = .round, tamano: CGFloat) }                                      // ChannelMark
struct PastillaCompeticion: View { init(_ competicion: CompetitionBadgeVista, tamano: TamanoPastilla = .md) }
struct TarjetaVersus: View { init(_ datos: DatosVersus, tamano: TamanoVersus, seleccionada: Bool = false) }
struct CarrilCarteles<Datos: RandomAccessCollection, Celda: View>: View where Datos.Element: Identifiable { init(_ datos: Datos, anchoCelda: CGFloat, sangrado: Bool = true, etiqueta: String, @ViewBuilder celda: @escaping (Datos.Element) -> Celda) }
struct SegmentadoPalco<ID: Hashable>: View { init(_ opciones: [OpcionSegmento<ID>], seleccion: Binding<ID>, bloque: Bool = false, altoOpcion: CGFloat = 36, rol: RolSegmentado = .radio, etiqueta: String) }
struct InterruptorStyle: ToggleStyle                                                    // 52×32, pulgar 26, desplazamiento 20, muelle estándar
struct CampoTexto: View { init(_ etiqueta: String, texto: Binding<String>, marcador: String = "", icono: NombreIcono? = nil, piel: PielCampo = .regular, pista: String? = nil, error: String? = nil, ocultarEtiqueta: Bool = false, @ViewBuilder derecha: () -> some View = { EmptyView() }) }
struct NumeroPalco: View   // §B.2
struct EstadoVacio<Acciones: View>: View { init(titulo: String, texto: String? = nil, error: Bool = false, @ViewBuilder acciones: () -> Acciones) }
struct Esqueleto: View { init(ancho: CGFloat? = nil, alto: CGFloat = 14, radio: CGFloat = R.s) }
struct FilasEsqueleto: View { init(_ filas: Int = 5, anuncio: String = "Cargando…") }
struct ToastVista: View { init(_ toast: Toast) }                        // §C.4
struct LineaEstadoVista: View { init(_ contenido: ContenidoLinea, sobreVideo: Bool) }
struct FlujoLayout: Layout { init(horizontal: CGFloat, vertical: CGFloat, alineacion: HorizontalAlignment = .leading) }
extension View {
    func tarjeta(radio: CGFloat = R.xl, relleno: CGFloat = S.s4) -> some View   // Card: surface + inset lineSoft + sombra .uno; publica @Entry radioInterior
    func pulsable() -> some View                                               // .press
    func islaOscura() -> some View
}
```

La **galería «Sistema»** (`Palco/Galeria/SistemaView.swift`, a1 §11) se construye con estas primitivas y es la primera pantalla que se compara con la web: 7 toques seguidos en «Versión» de Acerca de; `-AceNeoSistema` en Debug.

---

## C. Armazón (`Sources/Armazon` + `Sources/App`)

### C.1 Raíz y ciclo de vida

```swift
// App/AppDelegate.swift — @main (UIKit): sesión de audio .playback/.moviePlayback, orientaciones
@main @MainActor final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_: UIApplication, supportedInterfaceOrientationsFor _: UIWindow?) -> UIInterfaceOrientationMask   // lee Orientacion.mascara (⛶, a2 §27.8)
}
// App/SceneDelegate.swift — crea la ventana, enlaces aceneo:// (frío y caliente), accesos rápidos, ciclo de vida
@MainActor final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_:willConnectTo:options:); func scene(_:openURLContexts:); func windowScene(_:performActionFor:completionHandler:)
    func sceneDidBecomeActive(_:); func sceneWillResignActive(_:); func sceneDidEnterBackground(_:)
}
// App/HostingRaiz.swift
@MainActor final class HostingRaiz: UIHostingController<RaizView> {
    override var preferredStatusBarStyle: UIStatusBarStyle            // .lightContent sobre héroe/teatro; si no, por tema
    override var prefersStatusBarHidden: Bool                           // inmersivo
    override var prefersHomeIndicatorAutoHidden: Bool                   // inmersivo
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask
    // observa `AparienciaSistema` con `Observations { … }` (iOS 26) y llama a setNeedsStatusBarAppearanceUpdate()
}
@MainActor @Observable final class AparienciaSistema { var barraClara: Bool; var barraOculta: Bool; var indicadorOculto: Bool; var tema: Tema }
// App/CicloVida.swift — sustituye a scenePhase (no fiable fuera de App/WindowGroup)
@MainActor @Observable final class CicloVida { private(set) var fase: FaseEscena; private(set) var enSegundoPlanoDesde: Date? }
```

- **Tema**: `window.overrideUserInterfaceStyle` desde `@AppStorage("aceneo-tema")` (afecta también a hojas y menús del sistema). Migración de claves 0.8.0 → `aceneo-tema`/`aceneo-pb` en `AppDelegate.init` antes del primer fotograma (a1 §13.10).
- **Barra de estado**: blanca mientras el héroe está bajo ella (desplazamiento < `altoHeroe − safeT`, lo publica la agenda con `onScrollGeometryChange`) y en el teatro (fondo negro); en claro, oscura al dejar el héroe atrás (a3 §17-2, recomendado); oculta en inmersivo.

```swift
// App/RaizView.swift — dos fases con fundido (a2 §27.2); armazón montado ANTES del fundido
struct RaizView: View {
    @State var raiz: Raiz; let entorno: EntornoApp
    // ZStack { if armazonMontado { Shell() … opacity/offset } ; if emparejarMontado { PantallaEmparejar(motivo:) } }
    // .estilo(.cuerpo) · .sensoryFeedback(raíz, §B.8) · .environment(…) de todos los modelos
}
@MainActor @Observable final class Raiz { var app = false; var armazonMontado = false; var emparejarMontado = true; var motivo: MotivoEmparejar? }
```

### C.2 Estado de ruta (equivalente a `?vista=`) y navegación

```swift
// Armazon/Ruta.swift
enum Pestana: Int, CaseIterable, Sendable { case agenda, canales, buscar, ajustes }       // «Agenda · Canales · Buscar · Ajustes»
enum PestanaCanales: String, Sendable { case favoritos, recientes, listas }
enum SeccionAjustes: String, CaseIterable, Sendable { case listas, futbol, reproduccion, donde, apariencia, dispositivos, servidor, salud, motor, acerca }
enum Ruta: Hashable, Sendable {
    case agenda, canales(PestanaCanales?), buscar(q: String?), ajustes(SeccionAjustes?)
    case partido(id: String), canal(hash: String), sistema
    var profundidad: Int { /* 0,1,2,3 · partido/canal 10 · sistema 11 (routes.ts) */ }
    init?(texto: String)                    // "partido/demo-1", "ajustes/salud"… (lo usa -AceNeoRuta y los UITests)
}
// Armazon/Navegador.swift
@MainActor @Observable final class Navegador {
    private(set) var pestana: Pestana = .agenda
    private(set) var capa: Ruta?                           // partido/canal/sistema encima de las pestañas (pila de 1)
    private(set) var direccion: Direccion = .adelante      // por profundidad, como router.tsx
    private(set) var visitadas: Set<Pestana> = [.agenda]
    var subpestanaCanales: PestanaCanales?                 // se recuerda (equivale a &pestana=)
    var seccionAjustes: SeccionAjustes?                    // replaceState: no apila
    var posiciones: [Pestana: ScrollPosition]              // memoria de scroll + «tocar la activa sube»
    func ir(_ ruta: Ruta, desde origen: OrigenTransicion? = nil)    // no-op si es la misma (salvo pestaña activa → sube)
    func atras()                                           // cierra la capa (el reproductor pasa a mini) o vuelve a la agenda
    var hayHojaOMenu: Bool                                 // para la sonda de la barra de estado y el gesto de borde
}
enum OrigenTransicion: Sendable { case tarjeta(id: String, rect: CGRect), heroe(id: String, rect: CGRect), mini(rect: CGRect), ninguno }
```

- **Pestañas vivas** (`PestanasVivas`): `ZStack { ForEach(visitadas) { … .opacity(activa ? 1 : 0).offset(x: activa ? desplazamiento : 0).allowsHitTesting(activa).accessibilityHidden(!activa) } }`; cambio con fundido + ±16 (`Movimiento.vista`), la que sale solo baja opacidad. Cada pestaña con su `ScrollView` + `.scrollPosition($pos)`: la posición se conserva sola; **tocar la activa** → `withAnimation(.estandar) { pos.scrollTo(edge: .top) }`.
- **Sonda de la barra de estado** (`SubeConLaBarra`, a2 §27.5): una sola `UIScrollView` con `scrollsToTop = true` (la de la pestaña o capa visible; ninguna con hoja/menú; carruseles siempre `false`, dentro de `CarrilCarteles`/tira de días).
- **Capa de partido/canal**: vista en el `ZStack` del `Shell` por encima de pestañas (sin `NavigationStack`: evita la barra del sistema, el gesto de atrás apagado al ocultarla y la dependencia de `.navigationTransition` para cerrar hacia el mini). Un partido distinto empieza arriba: `.id(ruta)`.
- **Volver desde el borde** (`BordeAtras: UIGestureRecognizerRepresentable` con `UIScreenEdgePanGestureRecognizer`, a2 §2.4/§27.4): solo con la capa del partido en vertical; la capa sigue al dedo 1:1, la pestaña de debajo entra de −16 × (1 − p); vuelve si `dx ≥ 0,35·ancho` o (`vx ≥ 450` y `dx ≥ 24`) (`Reglas/Gestos.volver`). Nunca en pestañas, inmersivo, hojas o emparejar. `accessibilityAction(.escape)`.
- **Estados globales** (a2 §23): toast «Backend no disponible; la app seguirá reintentando» (warn, 4 s, una vez); `accesoPerdido(motivo)` único (parar, cerrar hojas, borrar token/cachés, conservar direcciones, `warning`, fundido «atrás» a emparejar con el aviso); 403 `origin_forbidden` → `Capacidades` (§E.6).

### C.3 Maquetación, zonas seguras y horizontal

```swift
// Armazon/Maquetacion.swift
struct Maquetacion: Equatable, Sendable {
    var ventana: CGSize            // pantalla COMPLETA (tamaño + zonas seguras)
    var seguras: EdgeInsets
    var tipo: TipoMaquetacion { ventana.width >= 768 ? .tableta : .movil }       // mismas fronteras que lib/media.ts
    var horizontalBaja: Bool { ventana.width > ventana.height && ventana.height <= 540 }
    var estrecha380: Bool { ventana.width <= 380 }
    var altoHeroe: CGFloat { min(500, max(360, 0.6 * ventana.height)) }            // a3 §4.7
}
extension EnvironmentValues { @Entry var maquetacion: Maquetacion = .referencia390 }   // struct nonisolated + Sendable
```

- Se mide en la raíz con `onGeometryChange(for: Maquetacion.self)` sobre una vista **dentro** del área segura (`proxy.size` + `proxy.safeAreaInsets`), nunca con `GeometryReader` + `.ignoresSafeArea()` (dio insets a cero, `455264f`). El fondo es `.background { Palco.bg.ignoresSafeArea() }`; el contenido nunca ignora el área salvo el héroe, el cartel de emparejar y el inmersivo (explícitos).
- Reglas por ancho **de caja** (consultas de contenedor de la web: 340, 369/370, 419/420, 479/480, 520, 560, 579/580, 600, 620, 640) con `onGeometryChange` en la propia caja; por ancho **de pantalla** solo 380, 400, 479, 767/768.
- **Horizontal ≥ 768** (todos los iPhone salvo el SE): barra **superior** de 64 + safeT (`BarraSuperior`: marca 28×28 radio 8 con la marca oscura, 4 destinos de 104, píldora cápsula 104×44 con el muelle estándar, rayo del motor + «?» a la derecha; capa `glassDense` + filete al pasar 32 pt con `onScrollGeometryChange`), sin barra inferior ni velo, títulos 44, mini tarjeta abajo-izquierda 440, toasts abajo-derecha 420, **safeL respetada** (fallo de la web no copiado). Partido en horizontal = inmersivo.
- **iPhone SE horizontal** (667×375, `.movil` + `horizontalBaja`): barra inferior, héroe 360, controles «compactos» en inmersivo (⌄, sin Detener) (a2 §16.6, a4 §18.1).

### C.4 Barra de pestañas propia (la de la web, con Liquid Glass)

```swift
// Armazon/BarraPestanas.swift
struct BarraPestanas: View {
    // posición: izquierda safeL+12, derecha safeR+12, abajo safeB+10; alto 64 (borde incluido); radio 24 circular
    // interior: relleno 6 (+1 de borde) → celda = (ancho − 14)/4 (88 a 390, 157,25 en el SE horizontal)
    // GlassEffectContainer { ZStack(alignment: .leading) {
    //     RoundedRectangle(cornerRadius: 18, style: .circular).fill(Palco.accentWash)      // píldora 50 alto
    //        .frame(width: celda, height: 50).offset(x: CGFloat(pestana.rawValue) * celda)
    //        .animation(Movimiento.estandar(reducido), value: pestana)
    //     HStack(spacing: 0) { ForEach(Pestana.allCases) { ItemPestana($0) } } } }
    // .cristal(.denso, en: .rect(cornerRadius: 24, style: .circular))
    // .accessibilityElement(children: .contain).accessibilityLabel("Principal")
}
struct ItemPestana: View   // icono 24 (agenda/biblioteca/buscar/ajustes) + texto 11·620·88, separación 2, bloque centrado en 50
                           // color accentInk (activa) / text2; sin efecto al pulsar; .isSelected; large content viewer
```

- Tocar otra pestaña: `navegador.ir(…)` + `selection`; tocar la activa: sube arriba (sin háptica).
- Oculta en el partido e inmersivo (fundido 340 ms); **no** se esconde al desplazar; queda bajo el teclado (`.ignoresSafeArea(.keyboard, edges: .bottom)` en la capa).
- **Velo inferior** (`VeloInferior`): alto `safeB + 100` (con mini `safeB + 180`), `LinearGradient` desde abajo `bg` opaco hasta el 58 % → transparente, `allowsHitTesting(false)`, z 39; oculto con la barra.
- **Mini** (z 41): banda `safeL+12 … safeR+12`, abajo `safeB + 82`, alto ≥ 72, radio 18, relleno 9 6 9 9, `.cristal(.denso)`; entra con `opacity 0, y+12` y el muelle estándar.

### C.5 Cabeceras, avisos y línea de estado

- **`CabeceraVista`** (a2 §6, §21.9): `FlujoLayout(horizontal: 12, vertical: 4)` con título (30/800/125, −0,6, lh 33, una línea; 44 en ≥ 768) + acciones (Modo demo | motor, luego las de la vista); relleno `safeT + 20` / 16 (24 arriba en ≥ 768). Motor sin texto si `estrecha380`. Sobre el héroe: `.islaOscura()` + blanco.
- **Toasts** (`CapaAvisos`, port de `notices/*` en `Nucleo/Avisos/Avisos.swift`, §E):

```swift
enum PosicionAvisos {   // en el paquete (Reglas/Avisos.swift), con tests
    static func calcular(_ m: MaquetacionPura, barraVisible: Bool, miniVisible: Bool, inmersivo: Bool) -> Colocacion
}
// móvil: centrado, lados safe+12, borde inferior = safeB + 94 (barra) · safeB + 178 (barra + mini) · safeB + 12 (partido)
// ≥ 768: abajo-derecha, ancho min(420, ancho − 40), a safeR + 20 y safeB + 20; con mini y 768–919 de ancho: safeB + 104
// inmersivo: opacidad 0 y sin toques (se anuncian igual)
```

Toast: `min(420, 100 %)`, alto ≥ 52, relleno 6 6 6 16, radio 26, `.cristal(.denso)`, icono 20 por tono, texto 15/560 lh 1,25 (`TextoMultilinea` si parte), «×n», acción 44 `accentInk` + ✕ «Cerrar aviso» solo con acción; máx. 2, 2,8 s (6 s con «Deshacer»), entrada `opacity + y12 + scale .98` (muelle estándar), salida `opacity + y6` 320 ms; **recolocación de los demás con el muelle estándar** (mejora nativa: la web salta). `AccessibilityNotification.Announcement` al crear.

- **Línea de estado** (cápsula sobre el vídeo): la pinta el teatro (§D.3); el modelo es `Avisos.linea` (aviso 4,5 s + estado base; se vacía al salir del partido).

### C.6 Hojas nativas con el contenido de la web

```swift
// Armazon/HojaPalco.swift
enum TamanoHoja: Sendable { case sm, md, lg }      // 420 / 560 / 760 de ancho máx. del contenido en ≥ 768
struct HojaPalco<Cuerpo: View, Pie: View>: View {
    init(titulo: String, descripcion: String? = nil, tamano: TamanoHoja = .md, cerrable: Bool = true,
         ocultarTitulo: Bool = false, @ViewBuilder cuerpo: () -> Cuerpo, @ViewBuilder pie: () -> Pie)
    // cabecera: título 22/800/125 −0,01 lh 27,5 (relleno 0 12 0 20) + BotonIcono(.x, "Cerrar") si cerrable
    // descripción 15 text2 (2 20 0) · cuerpo ScrollView relleno 16 20 20 · pie en .safeAreaInset(edge: .bottom):
    //   filete lineSoft, relleno 12 20 (12 + safeB), botones que se estiran (móvil) / a su ancho a la derecha (≥ 768)
}
extension View {
    /// .sheet(item:) + presentationDetents([.height(medida)] o [.large] para lg), .presentationDragIndicator(.visible),
    /// .presentationBackground(Palco.glassSolid), .presentationCornerRadius(24), .presentationContentInteraction(.scrolls),
    /// .interactiveDismissDisabled(!cerrable), háptica medium si se cierra sin acción, .sensoryFeedback propio (§B.8).
    func hojaPalco<Item: Identifiable, Contenido: View>(_ item: Binding<Item?>, @ViewBuilder contenido: @escaping (Item) -> Contenido) -> some View
}
```

- Alto = el del contenido (medido con `onGeometryChange`, tope `alto − safeT − 24`), como la web; `lg` (gustos) = `.large`. En horizontal bajo (≤ 540) la hoja se desplaza entera y cabecera/pie quedan fijos (`safeAreaInset(edge: .top/.bottom)`), contenido centrado con ancho máx. 420/560/760.
- Transición de apertura desde el botón que la abre: `.matchedTransitionSource(id:in:)` en el botón + `.navigationTransition(.zoom(sourceID:in:))` en la hoja (API de iOS 18+ segura para `.sheet`).
- Catálogo de hojas: gustos (lg), pegar (sm), reportar (sm), encontrar canal (md), guardar favorito (sm), renombrar (sm), ayuda «Atajos de teclado» (md; en táctil: Gestos, Teclado, Ratón), ¿emparejar con otro servidor? (sm), datos técnicos (sm, en inmersivo o sin pestaña), galería.
- Foco inicial con `@FocusState` (campo) o `@AccessibilityFocusState` (primer control que no es «Cerrar»).

### C.7 Menús nativos con el contenido de la web

```swift
// Armazon/AccionMenu.swift
struct AccionMenu: Identifiable {
    let id: String; let titulo: String; var icono: NombreIcono?
    var peligro = false; var marcada: Bool?; var deshabilitada = false; var separadaAntes = false
    var haptica: TipoHaptica?; let accion: @MainActor () -> Void
}
struct ContenidoMenu: View { init(_ acciones: [AccionMenu]) }   // Section por separador; Button(role: .destructive) si peligro;
                                                              // Label(titulo, image: IconoImagen); ✓ con Toggle; .disabled
extension View {
    func menuContextual(_ acciones: @escaping () -> [AccionMenu], @ViewBuilder vistaPrevia: @escaping () -> some View) -> some View
        // .contextMenu { ContenidoMenu(acciones()) } preview: { vistaPrevia() } + .accessibilityActions (mismo orden y textos)
}
struct BotonMas: View { init(etiqueta: String = "Más opciones", acciones: @escaping () -> [AccionMenu]) }  // Menu { } label: { BotonIcono(.more) }.menuOrder(.fixed)
```

| Menú (web) | Disparador nativo | Vista previa |
|---|---|---|
| Tarjeta de partido «Opciones de {L} vs {V}» (a3 §6.5) | `.contextMenu` en `TarjetaPartido` | la `TarjetaVersus` md |
| Fila de canal «Acciones de {nombre}» (a5 §3.9) | `.contextMenu` en `FilaCanal` + `BotonMas` | la fila |
| Cartel de fuente «Fuente {n}» (a4 §12.6) | `.contextMenu` en `CartelFuente` | el cartel |
| Vídeo «Opciones del reproductor» (14 elementos, a4 §5.6) | `BotonMas` ⋯ y `.contextMenu` en el vídeo | tesela del canal + título + cápsula de fase (la capa de vídeo no se fotografía bien) |
| Fila de dispositivo «Opciones de {nombre}» (a6 §8.9) | `.contextMenu` | la fila |
| «Listas guardadas», «Abrir en otra app» | `Menu` | — |

- Orden fijo (`.menuOrder(.fixed)`), textos y peligro exactos; el menú del vídeo **se desplaza** en horizontal (el fallo de la web, 6 opciones fuera de pantalla, desaparece solo).
- Hápticas de cada opción al elegirla (tabla a4 §5.7); al **abrir** vibra el sistema.

### C.8 Transición tarjeta → teatro (elemento compartido propio)

```swift
// Armazon/TransicionTeatro.swift
@MainActor @Observable final class TransicionTeatro {
    var origenes: [String: CGRect]           // tarjetas/héroe/mini publican su frame global con onGeometryChange
    var vuelo: Vuelo?                         // activo solo durante la animación
    struct Vuelo { let id: String; let desde: CGRect; let radioDesde: CGFloat; var progreso: Double; let ida: Bool }
    func abrir(_ id: String, desde origen: OrigenTransicion)     // llamado por Navegador.ir(.partido)
}
struct CapaTeatroAnimada: ViewModifier   // la capa del teatro con frame interpolado desde `desde` hasta la pantalla,
                                         // clip .rect(cornerRadius: radioDesde → 0), muelle estándar (0,12 s reducido)
```

- **Ida**: la tarjeta (16:10 de la fila, 16:9 del héroe o el mini) crece hasta el teatro; dentro, el bloque «escudo · pastilla · escudo» funde con la fila de equipos de `CabeceraPartido` (`plusLighter`, a3 §4.8); la agenda se funde. **Vuelta** (⌄, borde, vídeo abajo): el teatro encoge hacia **el mini** (no hacia la tarjeta: la web minimiza a mini) con la capa de vídeo ya en el hueco del mini. Sin origen (Buscar, Canales, zapping): fundido + 16 (web).
- `@Animatable` (iOS 26) si está en el SDK 26.5 (comprobar en la Fase 0); si no, `animatableData` a mano.

### C.9 Zonas seguras, tema y transparencia reducida

- Contenido siempre dentro del área segura; solo el **fondo** la ignora. Héroe y cartel de emparejar: a sangre bajo la barra de estado, fila de chips a `safeT + 76`, velo `safeT + 96` (valores reales, a3 §4.7).
- Tema Sistema/Claro/Oscuro: `@AppStorage("aceneo-tema")` → `window.overrideUserInterfaceStyle`. Transparencia: `@AppStorage("aceneo-transparencia")` + `accessibilityReduceTransparency` → `@Entry cristalOpaco`.
- `scrollEdgeEffect` de iOS 26 desactivado arriba en las pestañas (`.scrollEdgeEffectHidden(true, for: .top)` — **verificar nombre en el SDK 26.5** en la Fase 0; si no existe, no se usa).

### C.10 Pantalla de emparejar (lo único nuevo)

La de a2 §22 al pie de la letra: cartel de cámara a sangre (alto `altoHeroe`, radio 0 0 24 24, isla oscura, ventana 232 radio 24 al 52 %, marco oro, velo `safeT + 96`, cabecera «Emparejar» blanca, cápsula de indicación de cristal de vídeo con los 9 estados de a2 §22.3.1), texto de entrada, fila de error/aviso, tarjeta «Escribir el código» (celdas 0,72 em de 30/800/125, direcciones de casa y Tailscale), botón «Emparejar», horizontal en dos columnas, hoja «¿Emparejar con otro servidor?» y fundido emparejar → agenda (armazón montado antes, a2 §22.6). `ModeloEmparejar` = `PairingViewModel` + estados de cámara + canje automático de `aceneo://pair?u=…[&u=…]&c=…` (todas las `u`, la primera para el canje, a9 §3.4).

### C.11 Accesos rápidos

`UIApplicationShortcutItems` estáticos «Agenda de fútbol» y «Canales» (a2 §25); en frío se aplica al primer pintado sin animación; en caliente cierra hojas/menús, sale del inmersivo, vacía la capa (el partido pasa a mini) y cambia de pestaña con `selection`.

### C.12 Fallos de la web que NO se copian

| Fallo | Se hace |
|---|---|
| Contenido sin `safeL` en horizontal | respeta `safeL` |
| Menús recortados a la ventana, no a la zona segura; menú del vídeo cortado en horizontal | menús del sistema (zona segura y desplazamiento) |
| Hápticas del mapa no cableadas (barra, cerrar hoja, 4 pulsaciones largas) | cableadas (§B.8) |
| Cápsula de directo/oro que pierde el color con transparencia reducida | conserva rojo y oro |
| Hoja sin botonera sin `safeB` | `.sheet` nativa |
| Hoja del SE horizontal con esquinas de abajo rectas | `.sheet` nativa |
| Barra superior de 64 en vez de 52 (orden de CSS) | **se calca 64** (es lo que se ve y está aprobado) |

---

## D. Reproductor

### D.1 Una sola `AVPlayerLayer`

`SuperficieVideo` (se queda) con prioridades nuevas:

```swift
public enum PrioridadHueco: Int, Sendable, Comparable { case mini = 1, portada = 2, teatro = 3, inmersivo = 4 }
public struct VistaVideo: UIViewRepresentable { init(superficie: SuperficieVideo, prioridad: PrioridadHueco, gravedad: AVLayerVideoGravity = .resizeAspect) }
```

- Teatro (16:9 a lo ancho bajo `safeT` negro), mini (96×54, radio 10), inmersivo (`ignoresSafeArea`, fondo negro), **portada** reservada (la web no pinta vídeo en el héroe: el hueco existe pero no se monta salvo que Isma lo pida). Nunca `VideoPlayer`/`AVPlayerViewController`. PiP sobre esa capa con arranque automático al salir (`canStartPictureInPictureAutomaticallyFromInline`).

```swift
// Nucleo/Reproduccion/PresentacionReproductor.swift  (lo que sale de Reproductor/AppModel, a8 §3.2, §3.8.6)
@MainActor @Observable final class PresentacionReproductor {
    enum Modo: Sendable { case oculto, mini, teatro, inmersivo }
    private(set) var modo: Modo
    var controlesVisibles: Bool               // autoocultado 3,2 s solo en .reproduciendo; nunca con VoiceOver
    var pantallaCompletaForzada: Bool         // ⛶ / doble toque
    var arrastreMini: CGSize; var arrastreTeatro: CGFloat
    func alternarControles(); func rearmarAutoocultado(); func minimizar(); func expandir(ruta: Ruta)
}
```

### D.2 Máquina de estados y textos (`status.ts`)

- `MaquinaConexion` + `FaseReproductor.derivar` (port de `machine.ts`, se quedan) con la fase `bloqueado` presente aunque AVPlayer no la use.
- Puras en el paquete, **con vectores de `player/status.ts`**:

```swift
public enum EstadoBaseLinea { public static func para(_ e: EntradaEstadoReproductor) -> ContenidoLinea }   // statusFor (a4 §7.3, a7 §9.7)
public enum BotonDirecto   { public static func modo(_ e: EntradaEstadoReproductor) -> ModoBotonDirecto } // off/live/behind/resume (a4 §5.4)
public enum MensajeEscenario { public static func para(_ e: EntradaEstadoReproductor) -> MensajePanel? }  // stageMessage (a4 §8.1)
public enum TextosReposo { public static func texto(_ motivo: MotivoReposo) -> String }                   // IDLE_MESSAGES
public struct EntradaEstadoReproductor: Sendable, Hashable { fase, conexion, arranco, intento, espera, lead, retrasoS, porDetrasS, demo, motivoReposo… }
```

- Cambios del núcleo obligatorios (a8 §3.11): primer fotograma = `isReadyForDisplay && timeControlStatus == .playing && avance ≥ 0,05 s`; mensajes de §3.11.8; vigilante HLS nativo (36/4/16 tics de 1,5 s); perfiles 12/8/4 s sin reconectar; visor `v_` + 14 base64url por proceso.

### D.3 El teatro (vertical 390×844)

- Escenario fijo arriba (`safeT` negro + marco 16:9), `ScrollView` debajo con cabecera (kicker + escudos solapados + nombres 22/800/125), **barra de pestañas pegada** (`LazyVStack(pinnedViews: [.sectionHeaders])`, fondo `bg`, relleno 8 16, «Fuentes n · Partido · Datos técnicos», segmentado a todo el ancho, 44 de alto, 88 % en ≤ 400) y paneles montados los tres (`ZStack` + opacidad; alto mín. 40 % de la ventana).
- Capas del marco (a4 §5.1): vídeo · corte a negro (560 ms: 1 hasta 55 %, luego ease-out; `keyframeAnimator` disparado en el mismo `onChange(of: hash)`) · capa de toques · panel de mensaje / spinner / rótulo demo · controles (`GlassEffectContainer`, velo de 6 paradas, fila superior ⌄ · cápsula del marcador · ☆ PiP ⋯, fila inferior pausa 52 · ↺30 🔊 · [Directo · AirPlay · ⛶]) · cápsula de estado (abajo-izquierda, sube −60 con controles; −64 en ≥ 768).
- **AirPlay** (decisión 6): `AVRoutePickerView` (tinte blanco, 44) en la cápsula derecha, **solo si hay rutas** (`AVRouteDetector.multipleRoutesDetected`); si no cabe (375 con «Reanudar»), «Directo» pasa a su forma compacta antes que solaparse.
- Variantes por **ancho del marco** (369/419/479/579) y por maquetación (`compact` = `.movil`), no por modelo.

### D.4 Sesión de fuentes (`session.ts` + `model.ts`)

```swift
// Nucleo/Reproduccion/SesionFuentes.swift — vida de PROCESO (sigue con el mini)
@MainActor @Observable final class SesionFuentes {
    private(set) var estado: EstadoSesionFuentes          // key, kind, match, phase, entries, activeHash, scan, autoVerified,
                                                          // switchArmed, manualChosen, researching, stopped, failureText, hojas
    init(api: any APIFuentes, reproductor: any ControlReproductor, avisos: any Avisador, haptica: Haptica, reloj: any Reloj, identidad: Identidad)
    func entrarPartido(_ p: InfoPartido); func entrarCanal(_ c: InfoCanalSuelto); func salirDeLaVista()
    func elegir(_ id: String); func paso(_ delta: Int)                      // selectSource / stepSource (visibles, circular)
    func pegar(_ texto: String); func rebuscar() async; func reportar(_ id: String, motivo: SourceReportReason) async
    func confirmar(_ id: String) async; func elegirCandidata(_ c: ResolutionCandidate, recordar: Bool) async; func vincularManual(_ texto: String) async
    func procesar(_ e: SSEEvent)                                            // scan.progress / scan.verdict
    var visibles: [FilaFuente] { get }; var plegadas: [FilaFuente] { get }; var progreso: ProgresoComprobador { get }
}
public protocol ControlReproductor: AnyObject { @MainActor func reproducir(_ c: CanalReproducible, origen: OrigenReproduccion); @MainActor var enPantalla: EnPantalla? { get }; … }
```

- Port **literal** de a4 §20 / a7 §10: constantes (3 min, 30 min, 60 s, 3 iniciales, 1,5 s, 3 fallos, 32 consultas, 20/30 s, 3 reconexiones / 1 en automático), arranque automático, salto de entrada, fuente agotada automática/manual, rebuscar, reportar y su seguimiento, «Es el canal correcto», «Encontrar canal», regla 22 de plegadas. Textos exactos comprobados contra `textos-web.json` (§E.5).
- La reglas puras (`effectiveOf`, `signalOf`, `detailOf`, `presentationOf`, `qualityLabel`, `pickAutoSource`, `isShownWhileScanning`, `describeSource`…) viven en `Reglas/Fuentes.swift` con vectores; la clase solo orquesta.

### D.5 PiP, AirPlay, pantalla de bloqueo, segundo plano

- `AVAudioSession(.playback, mode: .moviePlayback, policy: .longFormVideo)`, `UIBackgroundModes: audio`; en segundo plano sin PiP se suelta la capa para que siga el audio (ya existe).
- `MPNowPlayingInfoCenter`: título = canal (‖ «Ace Player Neo»), artista = subtítulo («Fuente 1, Elcano» / «Fuente n de m») ‖ «Ace Player Neo», álbum «Ace Player Neo», carátula = marca oscura, `IsLiveStream`; `nil` en idle/error. `MPRemoteCommandCenter`: play, pause, toggle, **stop**, **−30 s** (`preferredIntervals = [30]`), anterior/siguiente solo con zapping (a8 §3.11.6).
- Latido 15 s (+ inmediato al volver a activa), soltar con `user` al detener, sesión caducada a 45 s sin latido al matar la app.

### D.6 Gestos del teatro y del mini (umbrales de la web + añadidos)

| Gesto | Dónde | Regla | Háptica |
|---|---|---|---|
| Toque | vídeo | alterna controles; rearma 3,2 s | — |
| **Doble toque** (+) | vídeo | vertical ↔ inmersivo (`requestGeometryUpdate`); el toque simple espera a que falle el doble (`UITapGestureRecognizer` con `require(toFail:)`, ~250 ms) | medium |
| Arrastrar abajo | vídeo, vertical no inmersivo | sigue al dedo (el teatro encoge hacia el mini); minimiza si `dy ≥ 56` o 450 pt/s con ≥ 24, eje vertical (1,4×) | light |
| **Arrastrar a los lados** (+) | vídeo, con ≥ 2 fuentes visibles (o hermanas) | texto «Emitiendo» se desplaza `clamp(dx/3, ±60)`; izquierda = siguiente; mismo umbral 56/450; corte a negro | rigid |
| Borde izquierdo (+) | capa del partido | §C.2 | light |
| Pulsación larga | vídeo | `.contextMenu` (§C.7) | sistema |
| ‹ › y deslizar | barra «Emitiendo» | a4 §12.5 | rigid |
| Mini: arriba | mini | ≥ 72 o rápido → abre el partido (zoom desde el mini) | light |
| Mini: a un lado | mini | `translate(dx, dy>0 ? dy·0,25 : dy)`, opacidad `max(0,35, 1 − |dx|/320)`; cruzar 72 → heavy una vez; soltar pasado → sale `±110 %` y a los 220 ms detiene con toast «Reproducción detenida» + «Deshacer» (6 s) | heavy |

Todas las decisiones (clasificar, volver, soltar mini) son funciones puras en `Reglas/Gestos.swift` (port de `classifySwipe`, 8 pt de bloqueo, 1,4×, 56/72/24, 0,45 pt/ms) con tests. Los reconocedores son `UIGestureRecognizerRepresentable` (iOS 18+) donde conviven con `ScrollView` o con el borde (`shouldRequireFailureOf`).

---

## E. Datos

### E.1 Cliente API (se queda, con los cambios de a8 §3.11)

- `Endpoint` + `API` (rutas), `APIClient.enviar` con **plazo total** (carrera `withThrowingTaskGroup` petición ↔ `Task.sleep`), cancelación ≠ plazo, `.reloadRevalidatingCacheData` en GET / `.reloadIgnoringLocalCacheData` en el resto, reintento con la otra dirección **solo en GET**, textos del cliente de la web (`TextosCliente`), 401 con token → `accesoPerdido` salvo `olvidandoEste` (a9 §3.5.3).
- `PlazosWeb.swift` GENERADO: 12 s por defecto; `football` 14, `search` 15, `channelStream` 60, `directoriesSync` 50, `engineRestart` 20, `footballScan` 5, `resolve` 20/30; `ping` 4 y SSE 45 de inactividad (diferencias conscientes).
- Rutas 0.8.1 añadidas: `salud`, `guardarAjustes`, `crearCodigo(baseUrl:alternativas:)`, `dispositivos`, `revocar(id:)`.

### E.2 Caché de consultas (port de TanStack)

```swift
// Nucleo/Cache/CacheConsultas.swift
struct ClaveConsulta: Hashable, Sendable { let ruta: RutaID; let parametros: [String: String]; let query: [QueryParam] }
struct PoliticaConsulta: Sendable {
    var frescura: Frescura = .porDefecto          // ∞ con SSE abierto / 30 s sin él; .fija(600) para football
    var reintentos = 2                             // 1 s y 2 s, solo si retryable
    var alVolverActiva: AlVolver = .sinSSE         // .siempre (football) / .nunca (scores)
    var siempreAlMontar = false                    // playbackStatus (Dónde), devicesList, health, diagnostics
    var intervalo: (@Sendable (Date) -> Duration?)? = nil     // scores 8/45 s, preheat 30 s sin SSE…
    var habilitada = true
}
enum EstadoConsulta<V: Sendable>: Sendable { case vacia, cargando, datos(V, en: Date, refrescando: Bool), error(APIError, previo: V?) }
@MainActor @Observable final class CacheConsultas {
    func consulta<V: Decodable & Sendable>(_ ep: Endpoint<V>, clave: ClaveConsulta, politica: PoliticaConsulta) -> Consulta<V>
    func invalidar(_ ruta: RutaID); func invalidarTodo(); func escribir<V: Sendable>(_ v: V, en clave: ClaveConsulta)
    func sembrar(desde arranque: BootstrapResponse)          // bootstrap, libraryGet, preferencesGet, playbackStatus, engineStatus
}
@MainActor @Observable final class Consulta<V: Sendable> { var estado: EstadoConsulta<V>; func pedir() async; func refrescar() async }
```

- Una consulta se pide **al construir el modelo** de la pantalla (no en un `onAppear` tardío); `.task(id: clave)` cancela al irse. Escrituras directas tras mutaciones (a7 §4.3): biblioteca ↔ directorios, preferencias → bootstrap, ajustes, motor «reiniciando» y recomprobar a 2,5 s.
- `DiskCache` (agenda, biblioteca, arranque, preferencias) solo para pintar en frío; la verdad es la caché de consultas.

### E.3 Tiempo real (SSE) y qué invalida cada evento

```swift
// Nucleo/Red/TiempoReal.swift
enum EstadoTiempoReal: Sendable { case inactivo, conectando, abierto, respaldo, demo }
actor TiempoReal {
    init(cliente: SSEClient, cache: CacheConsultas, reloj: any Reloj)
    func arrancar(); func parar(); func volvioActiva(); func pasoASegundoPlano(suena: Bool)
    nonisolated var estados: AsyncStream<EstadoTiempoReal> { get }
    nonisolated func eventos(_ tipo: TipoEvento) -> AsyncStream<SSEEvent>     // reparto por tipo a Reproductor, SesionFuentes, SenalPartidos…
}
```

- Esperas `min(60, 3·2^min(n−1, 5))` s; `Last-Event-ID` guardado en memoria de proceso (también al volver de segundo plano); **respaldo** a los 10 s sin abrir: `playbackStatus` cada 5 s y `engineStatus` cada 20 s (solo activa) y `playback.nowPlaying` sintético si cambia; al abrir tras un corte invalida `playback` y `engine`. Segundo plano: si no suena nada, se cierra; si suena, se mantiene mientras iOS deje.

| Evento | Caché | Otros oyentes |
|---|---|---|
| `playback.nowPlaying` | `playbackStatus.nowPlaying/learningCount` | Reproductor (sintético: late ya) |
| `playback.sessions` | `playbackStatus.sessions` | Dónde, mini («otros dispositivos») |
| `playback.handoff` (dirigido) | — | Reproductor → «La reproducción ha pasado a otro dispositivo», `stop(.traspasado)` sin soltar |
| `stream.reopened` / `modeChanged` / `closed` / `stats` (dirigidos) | — | Reproductor (reenganchar, textos a7 §9.5, Datos técnicos, vigilante) |
| `engine.status` | `engineStatus` ← datos | Reproductor (motor de vuelta) |
| `scan.progress` | invalida `footballScan{id}` | `SenalPartidos` (20 min; `cancelled` borra), `SesionFuentes` |
| `scan.verdict` | invalida ese `footballScan` | `SesionFuentes.applyVerdict` |
| `state.changed {scopes}` | library → libraryGet+bootstrap · preferences → preferencesGet+bootstrap · directories → directoriesGet+libraryGet+bootstrap · bindings → resolve · reports → resolve+health · learning → playbackStatus+health · stats → health · nowPlaying → playbackStatus · settings → settingsGet+bootstrap | — |
| `diagnostics.new` | invalida `diagnosticsList`, `health` | — |
| `devices.changed` | invalida `devicesList` | Emparejar desde Ajustes (`paired` id nuevo); `revoked` propio sin `olvidandoEste` → `accesoPerdido(.revocadoDesdeOtro)` |
| `resync` | invalida **todo** | `VigiaVersion` (ping) |

### E.4 Sondeos (solo donde la web sondea)

| Qué | Cuándo | Periodo |
|---|---|---|
| `football` | nunca se sondea; caduca a 10 min; al volver a activa; ⟳ y **tirar para actualizar** | — |
| `scores` | día elegido con partido en `[start − 15 min, start + 3,5 h]` (agenda/partido); hoy con `minutos ∈ [−210, 15]` (Canales); vista visible | 8 s si algo `in`, si no 45 s |
| `football/preheat/:id` | por tarjeta montada con canales, en `[−45, +120]` min y no terminado | 30 s **solo sin SSE** |
| `football/scans/:id` | sesión de fuentes | 1,5 s **solo sin SSE** |
| `devices` | código a la vista, sin SSE, Ajustes visible, activa | 5 s |
| `playback` / `engine/status` | respaldo del SSE | 5 s / 20 s |
| Relojes | agenda 20 s (compartido) · Canales 30 s · Ajustes 60 s por sección · cuenta atrás 1 s | con la vista visible (`visible = pestaña activa && activa`) |

### E.5 Reglas puras portadas (paquete `AceNeoNucleo/Reglas`) y sus tests espejo

| Fichero Swift | Fuente web | Cómo se prueba |
|---|---|---|
| `RelojMadrid.swift`, `Fechas.swift` (tablas propias es-ES: «sept», «Jue», «jueves, 24 de septiembre», coma decimal) | `agenda/domain.ts` (`madridClock`, `madridHour`, `addDays`, `dayLabel`) | vectores |
| `Agenda.swift` (`minutesToMatch`, `matchStatus`, `keepUnitsTogether`, `defaultDay`, `resolveDay`, `effectiveMode`, `visibleMatches`, `isMine`, `groupByCompetition`, `countLive`, `featuredMatch`, `liveMinute`, `matchProgressAt`, `scoresWanted`, `scoresInterval`, `paintableScore`) | `agenda/domain.ts` | vectores + port de `domain.test.ts` |
| `Tarjetas.swift` (`versusWhen`, `versusSide`, `signalWord`, `signalTone`, `matchGlow`, `signalFromPreheat`, `signalFromScan`) | `agenda/cards.ts`, `data.ts` | vectores |
| `Marcadores.swift` (tapado/destapado, goles) | `score-reveal.ts`, `Scoreboard.tsx` (`GOAL_MS = 1200`) | port de tests |
| `Color.swift`, `Equipos.swift` | `lib/color.ts`, `lib/teams.ts` | vectores + `color.test.ts`, `teams.test.ts` |
| `ParaTi.swift`, `Canales.swift` (ya portados) | `@ace/shared domain` | vectores (existentes) + matriz T-088 |
| `Hash.swift` (`normalizeHash`) | `domain/hash.ts` | vectores |
| `Fuentes.swift` | `sources/model.ts` | vectores + `model.test.ts` (494 líneas) |
| `Biblioteca.swift`, `Emision.swift`, `Zapping.swift` | `library/model.ts`, `on-air.ts`, `player/zapping.ts` | vectores |
| `Busqueda.swift` (`cleanQuery`, `searchPhase`) | `search/model.ts` | vectores |
| `Listas.swift` (`syncFailureReason`, `sourceMeta`, `looksPrivateUrl`, `directoryErrorMessage`) | `directories/model.ts` | vectores |
| `Preferencias.swift` (catálogos, topes, `toggleValue`, `addCustomValue`, `preferenceSummary`, `preferencesBody`) | `preferences/model.ts` | vectores |
| `DondeSuena.swift` | `where-playing/model.ts` | vectores |
| `Salud.swift` (`summarizeEngine`, `formatUptime`, `formatWhen`, `serviceRows`, resumen, causas, `groupBySource`) | `health/model.ts`, `api/hooks.ts` | vectores |
| `Dispositivos.swift` (`lastSeenText`, `pairedText`, orden, `groupCode`, `spellCode`, `countdown`) | `devices/model.ts` | vectores |
| `Gestos.swift` (`classifySwipe`, volver, mini) | `lib/gestures.ts`, `MiniPlayer.tsx` | vectores + `gestures.test.tsx` |
| `Avisos.swift` (cola: máx. 2, ×n, 2,8/6 s, línea 4,5 s; `PosicionAvisos`) | `notices/toasts.ts`, `statusLine.ts`, `Shell.tsx` | port de `notices.test.tsx` y `wording.test.ts` |
| `EstadoReproductor.swift` | `player/status.ts` | vectores |
| `Numeros.swift` (`splitDigits`) | `ui/Num.tsx` | vectores |
| `HapticaReglas.swift` (anti-ráfaga 40 ms, selección muda) | `lib/haptics.ts` | port de `haptics.test.ts` |

- **Vectores**: `generar-vectores.mjs` se amplía y pasa a ejecutarse con `pnpm exec tsx` (resuelve `@ace/shared`); cada módulo con una batería de entradas **y reloj fijado** → `Vectores/<modulo>.json`; `--check` en la CI. Si un módulo tira de globales del navegador, el script instala un `localStorage` en memoria antes de importarlo.
- **Textos**: `generar-textos.mjs` extrae los literales de `notify(`/`toast(`/`fail(`/mensajes de `session.ts`, `runtime.ts`, `status.ts`, `notices/*` → `textos-web.json`; un test exige que cada uno (con `{n}` normalizado) exista en el catálogo Swift (`TextosFuentes`, `TextosReproductor`).
- Tests con estado portados a mano con reloj y motor falsos: `SesionFuentesTests` (de `session.test.ts`, 716 líneas), `AvisosTests`, `ReproductorTests` (existentes).

### E.6 Identidad, capacidades, versión

- `Identidad`: `deviceId` = prefijo del token; `viewerId = "v_" + 14 base64url` por proceso.
- `Capacidades` (memo en memoria): 403 `origin_forbidden` en `health`/`settingsUpdate`/`pairingCreate`/`devicesList`/`deviceRevoke` → sección en «necesita 0.8.1» (`AvisoVersion`, a9 §9.1); se olvida al cambiar `bootstrap.version` o el servidor.
- `VigiaVersion`: `ping` tras `resync`, reapertura del SSE y vuelta tras ≥ 30 min en segundo plano; si cambia la versión: olvida capacidades, invalida todo, toast «Tu Umbrel tiene ahora Ace Player Neo X.» (a7 §5.2).
- Red: `NWPathMonitor` → `ServerResolver.invalidar()` + reconectar SSE (cambio casa/Tailscale sin toast).

---

## F. Servidor simulado (= demo web) y UITests con capturas

### F.1 Dónde vive

- **Lógica pura** en el paquete (`AceNeoNucleo/Demo`), probada en Linux: `EstadoDemo` (biblioteca, preferencias, ajustes, dispositivos, historial), `RespuestasDemo.responder(_ p: PeticionDemo, ahora: Date, estado: inout EstadoDemo) -> RespuestaDemo` (ruta, cuerpo JSON, estado HTTP, espera 0/120/260 ms).
- **Envoltorio Apple** en `Sources/Debug/ServidorSimulado.swift` (`URLProtocol`, `#if DEBUG`) + `MotorSimulado` (señal a 1,8 s; «caíd» falla; estadísticas cada 1,5 s) + `ImagenDemo` (el campo de fútbol SVG de `player/index.tsx` redibujado con `Canvas` y el rótulo «reproducción simulada — en el Umbrel verías el stream real»).

### F.2 Cómo se generan los datos (mismos que `?demo=1`)

`scripts/generar-demo.mjs` (con `pnpm exec tsx`) importa **el código de la demo de la web** y escribe:

| Fichero | Contenido | Origen |
|---|---|---|
| `Demo/agenda.json` | plan de partidos (id, desplazamiento en min o día+hora, local, visitante, competición, canales), tabla `CLUBS`, competiciones, goles por minuto | `agenda/demo-data.ts` |
| `Demo/fuentes.json` | planes por partido (proveedor, resultado, `slow`, pares, intake/stream, códec), «Rebuscar» | `sources/demo-data.ts` |
| `Demo/buscador.json` | 14 canales con categoría y disponibilidad | `search/demo.ts` |
| `Demo/salud.json`, `Demo/diagnosticos.json` | salud y 9 entradas con «hace» | `health/demo.ts` |
| `Demo/base.json` | bootstrap, biblioteca, preferencias, ajustes (`share`), dispositivos, motor, playback (§13.7) | `api/demo/index.ts` + `packages/shared/fixtures/v1` |
| `Vectores/vectores-demo.json` | **salidas** de la demo web a relojes fijos: `football` en T0, `scores` en T0+{0,5,30,60,95,120} min, `scans` en pasos 0…12, hashes FNV/xorshift (`demoHash`, `fakeHash`), QR de adorno | ejecutando los manejadores de la web |

Swift porta los **algoritmos dinámicos** (ancla de 5 min, marcadores por minuto, pasos de 1 350 ms del comprobador, `demoHash`/`fakeHash`, id de trabajo, QR de adorno) y el test compara con `vectores-demo.json`. Resultado: misma agenda, mismos hashes, mismos guiones (demo-1 arranca Elcano a ~2,7 s, demo-4 Cierzo floja, demo-12 en espera, demo-2/3 abren «Encontrar canal»).

### F.3 Argumentos de lanzamiento (Debug; en Release se ignoran)

| Argumento | Qué hace |
|---|---|
| `-AceNeoDemo` | servidor simulado + emparejada + modo demo (sin SSE, marcas «Modo demo», toast inicial, «(demo)», nota «…en este iPhone.») |
| `-AceNeoServidorSimulado` / `-AceNeoEmparejado` | simulado «en vivo» con SSE simulado (flujos) |
| `-AceNeoServidor080` | 403 en las 5 rutas de la 0.8.1 |
| `-AceNeoReloj 2026-09-24T19:00:00+02:00` | reloj que **arranca** ahí y avanza (`protocol Reloj`) |
| `-AceNeoHistorialCapturas` | Recientes: HOY «DAZN 1», «DAZN»; ESTA SEMANA «Canal de prueba» |
| `-AceNeoRuta partido/demo-1` | abre directamente esa ruta (≈ `?vista=`) |
| `-aceneo-tema claro\|oscuro`, `-aceneo-transparencia reducida` | por el dominio de argumentos de `UserDefaults` |
| `-AceNeoSistema`, `-AceNeoEmpezarDeCero` | galería; E2E real |

- En demo de capturas el dispositivo propio es `dev_iphone_capturas`, para que el visor «iPhone de Isma» de «Dónde» no salga como «Este dispositivo» y la captura cuadre con la web.

### F.4 UITests y capturas

- `Tests/AceNeoUITests/Flujos/*` (uno por pantalla, escrito por su agente) con identificadores = `data-testid` de la web donde existan, si no los de a2 §22.9/a8 §6.3; ayudas `elementoUI`, `arrastrar`, **`sePinta`**.
- `CapturasPalcoUITests`: para cada vista de `final/` (22) y cada estado de a8 §8.4 → lanza con `-AceNeoDemo -AceNeoReloj … -AceNeoRuta <ruta> -aceneo-tema <tema>`, espera la señal «listo» de la pantalla, adjunta `XCUIScreen.main.screenshot()` con nombre **`<vista>-390x844-<tema>.png`**, rota (`XCUIDevice.shared.orientation = .landscapeLeft`) y adjunta `<vista>-844x390-<tema>.png`, y en claro/oscuro con `-transparencia-reducida`. Simulador **iPhone 16e** (390×844 pt); barra de estado fija con `simctl status_bar override`.
- `scripts/comparar-capturas.py`: referencias web recapturadas con reloj fijo (`revision-visual.mjs --reloj`), `deviceScaleFactor 3` y **zonas seguras emuladas** (inyectando `--safe-top: 47px; --safe-bottom: 34px`); máscara de la barra de estado y del indicador; comparación estricta en `-transparencia-reducida` y con tolerancia en las zonas de cristal; informe HTML como artefacto.

---

## G. Plan de implementación paralelizable

### G.1 Fase 0 · contratos que compilan (1 agente, 2–3 ciclos de CI)

1. Mover el núcleo: `Sources/Core/{Models,Dominio}` + `Endpoint`/`SSEParser`/`ErrorCatalog` → paquete; resto → `Sources/Nucleo`; borrar la interfaz (§A.2). Tests que se quedan, verdes (`swift test` en Docker + CI).
2. `project.yml`, `Info.plist`, fuentes, `generar-{tokens,iconos,plazos}.mjs` con `--check`.
3. **Contratos con cuerpos provisionales** (compilan; las pantallas las rellenan otros): `Ruta`, `Navegador` (completo: es pequeño), `Maquetacion`, `EstiloTexto`/`Mona`, `NombreIcono`/`IconoPalco`, todas las firmas de §B.9, `HojaPalco`, `AccionMenu`, `Haptica`, `Avisador`/`Aviso`, `Reloj`, `CacheConsultas`/`Consulta` (API + implementación mínima), `PresentacionReproductor`, `ControlReproductor`, `SesionFuentes` (API con estado vacío), `Shell` con las 4 pestañas como `Text` y la barra funcional. Comprobar las APIs dudosas (§G.5) con un fichero `ComprobacionSDK.swift` que las usa todas.
4. `revisar-swift.mjs` y CI ampliada (§G.4).

### G.2 Fase 1 · 8 agentes en paralelo (+1 servidor), carpeta exclusiva

| # | Agente | Carpeta exclusiva | Entrega |
|---|---|---|---|
| 1 | Datos | `Sources/Nucleo/{Red,Cache,Sesion}` | plazos, `CacheConsultas`, `TiempoReal`, sondeos, `SesionApp`, `Arranque`, `Identidad`, `Capacidades`, `VigiaVersion`; tests |
| 2 | Reglas y demo | `Paquetes/AceNeoNucleo/**`, `scripts/generar-{vectores,demo,textos}.mjs`, `Sources/Debug/**` | todas las reglas de §E.5 con vectores; demo §F; servidor simulado |
| 3 | Reproducción | `Sources/Nucleo/{Reproduccion,Avisos}` | cambios a8 §3.11, `SesionFuentes`, `PresentacionReproductor`, `Avisos`, `Haptica`, Now Playing, PiP |
| 4 | Palco | `Sources/Palco/**`, `Resources/Fuentes`, generadores de diseño | primitivas §B.9, cristal, sombras, galería «Sistema» (primera comparación) |
| 5 | Armazón | `Sources/{App,Armazon}/**`, `Sources/Pantallas/Emparejar/**`, `Nucleo/Emparejar`, `Config/*`, `project.yml`, `Tests/AceNeoUITests/Ayudas/**`, `CapturasPalcoUITests` | raíz, barras, velo, avisos, hojas, menús, transición, borde, orientación, accesos, emparejar |
| 6 | Agenda y biblioteca | `Sources/Pantallas/{Agenda,Canales,Buscar,Pegar}/**` + sus UITests | agenda, gustos, canales, buscar, pegar, renombrar, favorito |
| 7 | Partido | `Sources/Pantallas/{Partido,Reproductor}/**` + UITests | teatro, fuentes, inspector, hojas reportar/encontrar/datos, canal suelto, mini, inmersivo, gestos |
| 8 | Ajustes | `Sources/Pantallas/Ajustes/**` + UITests | 10 secciones, dispositivos 0.8.1 (QR CoreImage), servidor, salud, ayuda, segundo toque |
| 9 | Servidor 0.8.1 | `ace-player-neo/{packages/shared,apps/server,docs}` + versiones | a9 entero; en el PC (`corepack pnpm@10.18.2 -r test`) |

- Cada agente trabaja en su rama `fase3/<modulo>` desde la integración diaria y lanza `solo_compilar` sobre ella (los runners macOS de un repo público admiten varias ejecuciones a la vez; la concurrencia es por rama). Un integrador fusiona a `rediseno/nativa` y lanza la ejecución completa una vez al día.
- Las pantallas se escriben contra **datos de la demo** (el simulado de 2) y **modelos con API fijada** en la Fase 0; si 1 o 3 no han llegado, usan el provisional.
- Nadie toca `project.yml` salvo 5 (XcodeGen recoge las carpetas enteras: los ficheros nuevos no lo cambian).

### G.3 Fase 2 · integración y calco (2 agentes)

Referencias web recapturadas (reloj fijo, escala 3, zonas seguras emuladas, claro en 844×390, estados de a8 §8.4) → capturas del simulador → informe de diferencias → ajustes de tintes de cristal, alturas de línea y sombras. Fase 3: iPhone real con `docs/pruebas-iphone.md` (PiP, bloqueo, AirPlay, giro, cámara, Tailscale, barras de estado).

### G.4 CI (`ios.yml`)

- `solo_compilar` (ya está): añadir **compilación Release para dispositivo** (`xcodebuild build -configuration Release -destination generic/platform=iOS CODE_SIGNING_ALLOWED=NO`) y `swift test --package-path Paquetes/AceNeoNucleo` (sin simulador, ~1 min).
- Pasos rápidos antes de `xcodegen` (fallan en segundos): `revisar-swift.mjs`, `--check` de catálogo, vectores, demo, textos, tokens, iconos, plazos y `ORIGEN.json` de fuentes.
- Nuevas entradas: `ipa_sin_tests` (compilar + archive), `capturas` (lanza `CapturasPalcoUITests` + comparación; artefacto `AceNeo-comparacion`).
- Tests partidos: `-only-testing:AceNeoTests` sin repetición y `-only-testing:AceNeoUITests` con `-retry-tests-on-failure -test-iterations 2`.
- Simulador: preferir «iPhone 16e»; si no está, el más alto y avisar (las capturas dejan de ser comparables).
- `on.push.branches`: añadir `rediseno/nativa` y `fase3/**`.

### G.5 Cómo no romper la compilación sin Xcode

**APIs de iOS 26/18 que se usan (seguras)**: `glassEffect(_:in:)`, `Glass.regular.tint(_:).interactive()`, `GlassEffectContainer(spacing:)`, `onGeometryChange(for:of:action:)`, `onScrollGeometryChange(for:of:action:)`, `ScrollPosition` + `scrollPosition(_:)`, `scrollTargetBehavior(.viewAligned)`, `scrollTargetLayout()`, `contentMargins`, `scrollClipDisabled`, `sensoryFeedback(trigger:_:)`, `contentTransition(.numericText())`, `keyframeAnimator`, `PhaseAnimator`, `TimelineView`, `matchedTransitionSource(id:in:)` + `navigationTransition(.zoom(sourceID:in:))` (solo en hojas), `presentationDetents`/`DragIndicator`/`Background`/`CornerRadius`/`ContentInteraction`, `menuOrder(.fixed)`, `UIGestureRecognizerRepresentable`, `@Entry`, `@Observable`, `Observations`, `Mutex`, `Task.immediate`, `accessibilityActions`, `accessibilityShowsLargeContentViewer`.

**Se comprueban en la Fase 0 antes de depender de ellas** (si no compilan, plan B indicado): `scrollEdgeEffectHidden(_:for:)` (plan B: nada), `@Animatable` (plan B: `animatableData`), `Text.lineHeight` (no se usa: `estilo()` + `TextoMultilinea`).

**Prohibido** (lo rechaza `revisar-swift.mjs`):

| Patrón | Motivo |
|---|---|
| `#"…"#` con `"#` dentro | cierra la cadena (`1a3f24c`): usar `##"…"##` o JSON en ficheros |
| `GeometryReader` salvo en `Palco/Componentes` lista blanca; `.ignoresSafeArea()` dentro de uno | insets a cero (`455264f`) |
| `tabViewBottomAccessory`, `TabView`, `NavigationStack`, `List(`, `Form`, `Picker(`, `AsyncImage`, `VideoPlayer`, `.searchable` | no calcan o ya fallaron |
| `.monospacedDigit()`, `Font.custom(`, `.font(.body`/`.headline`…, `@ScaledMetric`, `.bold()`/`.fontWeight(` sobre Palco | tipografía |
| `#available`, `#if compiler` | mínimo 26 |
| `.contextMenu` sin pasar por `menuContextual` | acciones de VoiceOver olvidadas |

**Reglas de escritura**: cuerpos de `View` cortos (≤ ~40 líneas, subvistas con nombre, `@ViewBuilder` privados), `let` intermedios para colores y medidas, nada de ternarios encadenados en modificadores, cierres de `sensoryFeedback`/`onChange` con **tipos escritos**, `nonisolated struct … : Sendable` para valores de entorno, delegados con conformidad aislada (`extension X: @MainActor Protocolo`), sin KVO de AVFoundation (sondeo), sin `@unchecked Sendable` nuevos. Avisos `-warn-long-*` en Debug se tratan como errores en la revisión.

**Ciclo**: commit pequeño → `revisar-swift.mjs` en el PC (segundos) → `swift test` del paquete en Docker (minutos) → push → `gh workflow run ios.yml --ref fase3/<modulo> -f solo_compilar=true` (4–8 min; error de sintaxis ~1 min 40 s, de type-checker ~5 min 30 s) → corregir. Opcional: toolchain Swift para Windows y `swiftc -parse` para errores de sintaxis sin CI.

---

## H. Riesgos principales y mitigación

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | **Liquid Glass ≠ cristal de la web** (refracción, brillo, tinte) | todas las superficies flotantes difieren en píxel | decisión de Isma; tintes calibrados una vez; comparación estricta con transparencia reducida (colores exactos) y tolerante en zonas de cristal |
| 2 | Hojas nativas en tamaños parciales flotan con margen y el asa es la del sistema | diferencia visual en hojas pequeñas | decisión de Isma; `presentationBackground` opaco y contenido web exacto; en ≥ 768 columna de 420/560/760 centrada |
| 3 | Rendimiento de muchos `glassEffect` en carruseles | tirón al desplazar | un `GlassEffectContainer` por tarjeta; medir en el iPhone; plan B material + tinte solo para cápsulas de carteles |
| 4 | Fuente variable mal pedida (peso 200, sin anchura) | todo el texto mal | fábrica única + test de ejes + `revisar-swift.mjs` |
| 5 | Alto de línea CSS vs caja 1,41 em | desplazamientos de 2–5 pt, cortes distintos | `estilo()` + `TextoMultilinea` + test de alturas con la tabla de a3 §1.4.1 |
| 6 | Reglas que divergen de la web con el tiempo | datos distintos sin error visible | vectores y textos generados desde el TS con `--check` en la CI |
| 7 | Compilar sin Xcode (type-checker, APIs dudosas) | ciclos de 5–8 min perdidos | paquete puro probado en Linux, lint de patrones, Fase 0 con `ComprobacionSDK.swift`, cuerpos cortos |
| 8 | Transición propia tarjeta → teatro con la capa de vídeo moviéndose de hueco | parpadeo o vídeo doble | una sola capa por prioridad; el hueco del teatro entra al empezar el vuelo; test `SuperficieUnicaTests` |
| 9 | Gestos que chocan (borde, deslizar vídeo, scroll, `contextMenu`, «Emitiendo») | gesto que no arranca o roba el scroll | `UIGestureRecognizerRepresentable` con `require(toFail:)`; bloqueo de eje a 8 pt; pruebas en el aparato |
| 10 | Ciclo de vida UIKit (`HostingRaiz`) | `scenePhase` no fiable, `onOpenURL` no llega | `CicloVida` y `SceneDelegate` como única fuente; UITests de enlace en frío y en caliente |
| 11 | SSE en segundo plano y reanudación | datos viejos | `Last-Event-ID` de proceso, `resync` = invalidar todo, respaldo 5/20 s |
| 12 | Capturas no comparables (reloj, zonas seguras, escala, simulador) | comparación inútil | reloj fijo en los dos lados, zonas seguras emuladas en la web, escala 3, iPhone 16e, máscaras |
| 13 | Servidor 0.8.0 en casa | Dispositivos/Salud/interruptor en modo degradado | detección por 403 y `AvisoVersion`; app y servidor salen juntos como 0.8.1 |
| 14 | Double tap que retrasa el toque simple | controles que tardan 250 ms en aparecer | aceptado (ya ocurre con ratón en la web, 190 ms); medirlo en el aparato |
| 15 | AirPlay sin sitio a 375 | solapes en la fila inferior | solo con rutas detectadas; «Directo» compacto antes que solapar |
| 16 | `@Entry`/aislamiento en Swift 6 sin aislamiento por defecto | errores de compilación dispersos | valores de entorno `nonisolated struct Sendable`; modelos `@MainActor` explícitos |
| 17 | Menú del vídeo con vista previa de la capa de vídeo | vista previa negra | vista previa propia (tesela + título + fase) |
| 18 | Paralelismo: contratos que cambian a mitad | agentes bloqueados | contratos cerrados en la Fase 0; cambios solo por el integrador con aviso; provisionales siempre compilables |

---

*Fin de B1. Propuesta de arquitectura, fase 3, 25-sep-2026.*
