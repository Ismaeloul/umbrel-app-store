# B2 · Arquitectura de la app nativa de iPhone (SwiftUI, iOS 26) que calca la web «Palco»

> Fase 3 · propuesta de arquitectura (solo diseño: no se ha tocado ningún fichero del repositorio).
> Escrita el 25-sep-2026 tras leer enteras a1–a9 de esta carpeta, el núcleo de
> `ace-player-neo/apps/ios` (`project.yml`, `Sources/Core`, `Sources/Player`, `Sources/Features/Pairing`,
> `Sources/Debug`, `Tests`) y `.github/workflows/ios.yml` (con `solo_compilar` ya commiteado en `206a50d`).
>
> **Mandan las 10 decisiones de Isma** sobre cualquier recomendación de a1–a9. Donde una especificación
> dice otra cosa, la tabla de §0.2 dice qué se hace y por qué. Todo lo demás de a1–a9 (medidas, colores,
> textos, reglas, plazos, estados) se calca tal cual: este documento no los repite, los **ubica** (qué
> fichero Swift los implementa y contra qué se prueban).
>
> Rutas relativas a `ace-player-neo/apps/ios/` salvo que se diga otra cosa. «web» = `ace-player-neo/apps/web/src`.

---

## 0. La arquitectura en una página

### 0.1 Decisiones

1. **Un solo objetivo de app** (`AceNeo`) con aislamiento por defecto `nonisolated` (como hoy), `@MainActor`
   explícito en modelos y vistas, Swift 6 estricto. **Sin frameworks nuevos** en Xcode: partir el núcleo en un
   framework obligaría a poner `public` en cientos de declaraciones que ninguna persona puede compilar en este
   PC; el riesgo de romper la CI no compensa la ganancia de tiempo de compilación.
2. **Las reglas puras viven en un paquete espejo** `Paquetes/AceReglas` (Swift puro, solo `Foundation`): sus
   fuentes se compilan **dentro** del objetivo de la app (XcodeGen las incluye como carpeta de fuentes, sin
   dependencia de paquete) y, a la vez, un trabajo **Linux** de la CI las compila y ejecuta sus tests con
   `swift test` en 2–3 min. Es la vuelta rápida que hoy no existe: la mitad de la lógica (agenda, fuentes,
   colores, avisos, gestos, formatos) se valida sin macOS.
3. **Ciclo de vida UIKit** (`AppDelegate` + `SceneDelegate` + `HostingPalco: UIHostingController`) en lugar de
   `@main App` de SwiftUI: es la única forma estable de controlar **por pantalla** el estilo de la barra de
   estado (blanca sobre el héroe y el vídeo), las orientaciones permitidas (⛶), el indicador de inicio y los
   gestos del sistema en el inmersivo. SwiftUI sigue siendo el 100 % de la interfaz.
4. **Navegación**: pestañas vivas en un `ZStack` (conservan estado y scroll, como `<Activity>` de la web) y
   **un `NavigationStack` por pestaña con la barra del sistema oculta**. El teatro (partido/canal) se empuja
   con `.navigationTransition(.zoom(sourceID:in:))` desde la tarjeta, la fila, el cartel o el mini
   (`matchedTransitionSource`): el zoom nativo da gratis **volver desde el borde izquierdo** y **arrastrar
   hacia abajo para minimizar**, interactivos y con muelle (decisión 3).
5. **Barra de pestañas propia** con `glassEffect` (Liquid Glass de verdad), medidas de la web y píldora dorada
   que se desliza con el muelle estándar (decisión 4). En horizontal (≥ 768), la **barra superior** de la web,
   también con `glassEffect`. Sin `TabView`, sin `tabViewBottomAccessory`.
6. **Cristal = `glassEffect`** en todo lo que la web pinta con `.glass`/`.glass--video` (barra, mini, toasts,
   cápsulas y controles del vídeo, cápsula de estado); **opaco** (`--glass-solid`/`--glass-video-solid`)
   con «Reducir transparencia» del sistema **o** el interruptor propio. Lo que en la web no es cristal
   (tarjetas, segmentados, gota) sigue siendo superficie opaca.
7. **Hojas y menús nativos** (decisión 5): `.sheet` con `presentationDetents` y asa; `.contextMenu` con vista
   previa en tarjetas, filas, carteles, dispositivos y vídeo; `Menu` en «Más opciones». El **contenido**
   (títulos, textos, orden, iconos, peligro, marcas ✓, separadores) es el de la web, y las mismas opciones van
   como `accessibilityActions` (VoiceOver no depende de la pulsación larga).
8. **Una sola `AVPlayerLayer`** (la `SuperficieVideo` que ya funciona) que salta entre huecos por prioridad:
   `mini 1 < teatro 3 < inmersivo 4`. Reproductor, sesión de fuentes, PiP y pantalla de bloqueo viven fuera de
   las vistas (vida de proceso), como `player/runtime.ts` y `sources/session.ts`.
9. **Capa de datos calcada de TanStack**: `CacheConsultas` (`@MainActor @Observable`) con claves por ruta,
   frescura ∞ con SSE / 30 s sin él, reintentos 1 s y 2 s solo si `retryable`, `enabled`, `refetchInterval`,
   `refetchOnMount`; `TiempoReal` (actor) con SSE, `Last-Event-ID`, esperas 3·2ⁿ (tope 60 s) y respaldo por
   sondeo a los 10 s; `RepartidorEventos` aplica la tabla evento → invalidación de a7 §6.3–6.4.
10. **Servidor simulado = demo de la web**: un script ejecuta los módulos de demo de la web con un reloj fijo
    y genera semillas + vectores; el simulado Swift (`#if DEBUG`) sirve lo mismo por `/native/api/v1/*`.
    Capturas del simulador con el nombre exacto de las de la web (`agenda-390x844-oscuro.png`…) para
    compararlas con un script.
11. **Todo lo que viene de la web se genera y se comprueba con `--check` en la CI**: tokens de color, iconos,
    plazos, catálogo de errores, textos del reproductor, vectores de reglas y semillas de la demo. Si la web
    cambia, la CI de iOS se pone en rojo.

### 0.2 Dónde manda Isma sobre a1–a9

| Tema | a1–a9 decían | Se hace (decisión de Isma) | Consecuencia en la arquitectura |
|---|---|---|---|
| Cristal | material + tinte; «no usar `glassEffect`» (a1 §13.6, a2 §21.4) | `glassEffect` con tinte del token (3) | `Palco/Cristal.swift`; se calibra el tinte en el spike (§G.5) |
| Hojas | hoja propia en la raíz (a1 §10.18, a2 §21.7…) | `.sheet` nativa con detents y asa (5) | `Armazon/CentroHojas.swift`; desaparece `SheetHost`, la gestión del teclado y del arrastre del asa |
| Menús y pulsación larga | menú propio sin vibración (a2 §21.8, a4 §5.7) | `.contextMenu` con vista previa y `Menu` (5) | `Palco/Componentes/MenuPalco.swift`; la vibración la pone el sistema: **no se añade** `.medium` propia (sonaría doble) |
| Transición tarjeta → partido | capa viajera propia; «`.zoom` no se parece» (a3 §4.8) | `matchedTransitionSource` + `.navigationTransition(.zoom)` (3) | `NavigationStack` por pestaña (§C.5) |
| Volver desde el borde | reconocedor propio (a2 §27.4) | el del zoom nativo (3) | `BordeAtras` queda solo como plan B del spike |
| Tirar para actualizar | no existe en la web | `.refreshable` en la agenda (3) | solo Agenda |
| Tocar la pestaña activa | no hace nada (a2 §4.4) | sube arriba / vuelve a la raíz (3) | `Navegador.tocarPestanaActiva()` |
| Vídeo | doble toque sin efecto; deslizar abajo = minimizar | + doble toque = pantalla completa, + deslizar a los lados = cambiar de fuente (3) | `Pantallas/Teatro/GestosVideo.swift` |
| Cifras del marcador | sin animación salvo «paleta» al destapar | la paleta al destapar **y** cifras que ruedan al cambiar (3) | `Num` con `.contentTransition(.numericText(value:))` **dentro de cada celda fija** (nunca `.monospacedDigit()`) |
| Háptica | la web no vibra; mapa de intenciones | la tabla por sitio de a1 §8.1 (3) | `Palco/Haptica.swift` con anti-ráfaga de 40 ms |
| Horizontal | A (calcar ≥ 768) con pregunta abierta (a2 §16.0) | calcar la maquetación ≥ 768 (9) | `BarraSuperior`, mini 440, toasts a la derecha, inmersivo |
| Fallos de la web | calcar o corregir | corregir (9): `safeL` en horizontal, menús con zona segura (los da el sistema), vibraciones que faltan, cápsulas `live`/`gold` que pierden el color con transparencia reducida, menú del vídeo cortado en horizontal (nativo: se desplaza solo) | reglas explícitas en `ShellLayout` y `Capsula` |
| Icono y nombre | calcar el icono oscuro (a8 §7.4) | **mismo icono, nombre y bundle id que la app actual** (8) | `AppIcon.appiconset` intacto; `Marca.imageset` oscura para barra superior y pantalla de bloqueo (lo que pinta la web) |
| Versión | ¿0.9.0? | **0.8.1** app y servidor (8) | `MARKETING_VERSION = 0.8.1` |
| iPad | pendiente (a8 §13) | app de **iPhone** (1) | `TARGETED_DEVICE_FAMILY = 1` |
| Accesos rápidos del icono | añadidos (a2 §25) | fuera: la web en iPhone no los tiene («nada que la web no tenga») | no se implementan |
| Sección «Servidor» | añadida (a6 §8 bis) | se queda: es la cara visible del cambio casa/Tailscale (6) | `Pantallas/Ajustes/SeccionServidor.swift` |

---

## A. Proyecto, carpetas y ficheros

### A.1 Qué se borra, qué se queda y qué es nuevo

| Ruta de hoy | Veredicto | Destino |
|---|---|---|
| `Sources/App/RootView.swift` | **borrar** (copiar antes la lógica de `onOpenURL`) | → `Armazon/RaizView.swift` + `App/SceneDelegate.swift` |
| `Sources/App/AceNeoApp.swift` | **borrar** | → `App/AppDelegate.swift`, `App/SceneDelegate.swift` |
| `Sources/App/AppModel.swift` | **partir** | núcleo → `Nucleo/Datos/SesionApp.swift`; presentación → `Armazon/Navegador.swift`, `Reproduccion/PresentacionReproductor.swift` |
| `Sources/App/Entorno.swift` | queda (se amplía: `Reloj`, `CacheConsultas`, `TiempoReal`) | `App/Entorno.swift` |
| `Sources/Core/**` | **queda** (con los cambios de a8 §3.11) | `Nucleo/**` (`git mv`, sin cambiar nombres de tipos) |
| `Sources/Core/Dominio/{Canales,ParaTi}.swift` | queda | → `Paquetes/AceReglas/Sources/AceReglas/Dominio/` |
| `Sources/Player/**` salvo `ReproductorVistas.swift` | queda (a8 §3.11.5–§3.11.8) | `Reproduccion/**` |
| `Sources/Player/ReproductorVistas.swift` | **borrar** | — |
| `Sources/Player/GestosReproductor.swift` | forma sí, números no | → `AceReglas/Gestos/Gestos.swift` con los umbrales de la web |
| `Sources/Features/MatchCenter/CentroPartidoModelo.swift` | **evoluciona** | → `Reproduccion/SesionFuentes.swift` (port completo de `session.ts`) |
| `Sources/Features/Sources/ReglasFuentes.swift` | queda | → `AceReglas/Fuentes/` |
| `Sources/Features/Pairing/{PairingViewModel,QRScannerView}.swift` | quedan | → `Pantallas/Emparejar/` |
| `Sources/Features/Search/BuscarView.swift` → `BuscarModelo` | rescatar el modelo | → `Pantallas/Buscar/BuscarModelo.swift` |
| `Sources/Features/Settings/{DondeSuena,GustosView}` → reglas | rescatar reglas | → `AceReglas/Donde/`, `AceReglas/Preferencias/` |
| resto de `Sources/Features/**`, `Sources/Design/**` | **borrar** (7 900 líneas, a8 §4) | — |
| `Sources/Debug/{ServidorSimulado,MotorSimulado}.swift` | el motor queda; el servidor se **reescribe** con los datos de la demo web | `Simulado/**` |
| `Resources/Assets.xcassets/Colores/*` (23) | **borrar** | colores en código (§B.1); quedan `Bg` y `AccentColor` |
| `Resources/Assets.xcassets/AppIcon.appiconset` | **queda igual** (decisión 8) | — |
| `Resources/Assets.xcassets/Marca.imageset` | una sola variante (la oscura = `apps/web/public/icon.svg`) | barra superior y carátula de la pantalla de bloqueo |
| `Tests/AceNeoTests/*` | ~75 % queda (a8 §5) | + tests nuevos; los de reglas pasan a `AceReglasTests` |
| `Tests/AceNeoUITests/{AyudasUI,ServidorDePruebas,ServidorRealUITests}.swift` | quedan (adaptados) | — |
| `Tests/AceNeoUITests/{Emparejamiento,Reproduccion,Capturas}UITests.swift` | **reescribir** | identificadores nuevos (§F.6) |

### A.2 Árbol final

```
apps/ios/
├─ project.yml · Config/{AceNeo.xcconfig, Info.plist} · README.md
├─ Resources/
│  ├─ Assets.xcassets/ (AppIcon, AccentColor, Bg, Marca)
│  └─ Fuentes/ MonaSansPalco-Variable.ttf · MonaSans-Variable.ttf · MartianMono-Variable.ttf · OFL-*.txt
├─ Paquetes/AceReglas/                      ← Swift puro; lo compila la app Y el trabajo Linux
│  ├─ Package.swift
│  ├─ Sources/AceReglas/
│  │  ├─ Dominio/ ParaTi.swift · Canales.swift · Hash.swift
│  │  ├─ Agenda/ RelojMadrid.swift · EstadoPartido.swift · Dias.swift · Destacado.swift · Agrupar.swift
│  │  │          Marcadores.swift · Tarjetas.swift (versusWhen, signalWord…) · SenalPartido.swift · MarcadorTapado.swift
│  │  ├─ Color/ OKLab.swift · Equipos.swift (versusPair, teamLight, teamInitials, competitionShort) · Canal.swift
│  │  ├─ Fuentes/ ReglasFuentes.swift · Presentacion.swift · AutoArranque.swift · Progreso.swift
│  │  ├─ Reproductor/ EstadoBase.swift (statusFor) · MensajeEscenario.swift · BotonDirecto.swift · Textos.swift
│  │  ├─ Biblioteca/ Biblioteca.swift · EnAntena.swift · Zapping.swift
│  │  ├─ Busqueda/ Busqueda.swift     ├─ Listas/ Listas.swift     ├─ Preferencias/ Preferencias.swift
│  │  ├─ Donde/ Donde.swift           ├─ Salud/ Salud.swift        ├─ Dispositivos/ Dispositivos.swift
│  │  ├─ Avisos/ ColaToasts.swift · LineaEstado.swift (lógica pura de notices/*)
│  │  ├─ Gestos/ Gestos.swift (classifySwipe, mini, asa, borde, emitiendo)
│  │  └─ Formato/ FechasES.swift · NumerosES.swift · Texto.swift (foldText, keepUnitsTogether)
│  └─ Tests/AceReglasTests/ … + Vectores/*.json (generados desde el TS)
├─ Sources/
│  ├─ App/ AppDelegate · SceneDelegate · HostingPalco · EstadoVentana · Entorno · ModoEjecucion · Claves · MigracionClaves
│  ├─ Nucleo/
│  │  ├─ Auth/ Emparejamiento · Llavero · Servidores (PairingLink con varias u=)
│  │  ├─ Red/ APIClient · APIError · Endpoint · ErrorCatalog.generated · PlazosWeb.generated · Rutas · RutaID.generated
│  │  │       ServerResolver · SSEParser · SSEClient · VigiaRed (NWPathMonitor)
│  │  ├─ Datos/ CacheConsultas · Consulta · PoliticaConsulta · Consultas (catálogo) · TiempoReal · RepartidorEventos
│  │  │         SesionApp · Arranque · Identidad · Capacidades · VigilanteVersion · Reloj · RelojCompartido
│  │  │         SenalPartidos · MarcadoresDestapados · BajasPendientes · Mutaciones (biblioteca/preferencias optimistas)
│  │  ├─ Cache/ DiskCache · CacheImagenes
│  │  └─ Modelos/ (los de hoy)
│  ├─ Reproduccion/ MotorVideo · MotorAVPlayer · MaquinaConexion · Directo · ServicioReproduccion · Reproductor
│  │                ControlesSistema · SuperficieVideo · Orientacion · SesionFuentes · PresentacionReproductor
│  ├─ Palco/
│  │  ├─ Tokens/ ColoresPalco.generated · Colores · Tipografia · EstilosTexto · Medidas · Sombras · Movimiento
│  │  │          Haptica · Cristal · EntornoPalco (@Entry)
│  │  ├─ Iconos/ IconosPalco.generated · IconoPalco · IconoImagen
│  │  ├─ Componentes/ Boton · BotonIcono · EstiloPulsar · Tarjeta · Chip · Capsula · MedidorSenal · AnilloSenal
│  │  │               PuntoDirecto · Num · BarraProgreso · MarcaEquipo · MarcaCanal · PastillaCompeticion
│  │  │               TarjetaVersus · Carril · Segmentado · Interruptor · CampoTexto · EstadoVacio · Esqueleto
│  │  │               CabeceraVista · IndicadorMotor · Flujo (Layout) · ContenidoHoja · MenuPalco · ToastVista
│  │  │               LineaEstadoVista · SegundoToque · Ondas (TimelineView)
│  │  └─ Galeria/ SistemaView (7 toques en «Versión»)
│  ├─ Armazon/ RaizView · AppShell · ShellLayout · Navegador · Ruta · CapaPestanas · PilaPestana · BarraPestanas
│  │           BarraSuperior · VeloInferior · CapaAvisos · CapaMini · CapaInmersiva · CentroHojas · SubeConLaBarra
│  │           EstadosGlobales · IdentificadoresUI (compartido con los UITests)
│  ├─ Pantallas/
│  │  ├─ Emparejar/ PantallaEmparejar · CartelCamara · VentanaEscaner · TarjetaCodigo · CeldasCodigo · EmparejarModelo
│  │  │              QRScannerView · ContenidoOtroServidor
│  │  ├─ Agenda/ AgendaView · AgendaModelo · Heroe · CabeceraAgenda · TiraDias · FilaFiltro · GrupoCompeticion
│  │  │          TarjetaPartido · TarjetaPrimerUso · PieAgenda · ContenidoGustos · GustosModelo
│  │  ├─ Teatro/ TeatroView · TeatroModelo · EscenarioVideo · ControlesVideo · GestosVideo · CapsulaMarcador
│  │  │          CapsulaEstadoVideo · PanelMensajeVideo · CorteNegro · CabeceraPartido · CabeceraCanal · PestanasTeatro
│  │  │          PanelFuentes · CartelFuente · BarraEmitiendo · InspectorFuente · PanelPartido · PanelDatosTecnicos
│  │  │          ContenidoReportar · ContenidoEncontrarCanal · MenuReproductor
│  │  ├─ Mini/ MiniReproductor · GestosMini
│  │  ├─ Canales/ CanalesView · CanalesModelo · FilaCanal · CartelCanal · EmitiendoAhora · CabeceraCategoria
│  │  │           ContenidoRenombrar · ContenidoGuardarFavorito · MenuCanal
│  │  ├─ Buscar/ BuscarView · BuscarModelo · EnlaceDetectado
│  │  ├─ Pegar/ ContenidoPegarHash
│  │  └─ Ajustes/ AjustesView · AjustesModelo · IndiceChips · SeccionListas · SeccionTuFutbol · SeccionReproduccion
│  │              SeccionDonde · SeccionApariencia · SeccionDispositivos · EmparejarOtroModelo · QRPalco
│  │              SeccionServidor · SeccionSalud · SeccionMotor · SeccionAcercaDe · ContenidoAyuda · AvisoVersion
│  └─ Simulado/ (todo #if DEBUG) ServidorDemo · EnrutadorDemo · EstadoDemo · AgendaDemo · FuentesDemo · MarcadoresDemo
│               SaludDemo · BuscadorDemo · SSEDemo · EscenasCaptura · MotorSimulado · ImagenDemo · Generado/SemillasDemo.generated
├─ Tests/
│  ├─ AceNeoTests/ (núcleo, datos, reproductor, simulado, fuentes, tokens, iconos, prohibiciones)
│  └─ AceNeoUITests/ AyudasUI · ServidorDePruebas · FlujoEmparejarUITests · FlujoAgendaUITests · FlujoTeatroUITests
│                    FlujoMiniUITests · FlujoCanalesUITests · FlujoAjustesUITests · CapturasPalcoUITests · ServidorRealUITests
└─ scripts/ build-ipa.sh · pila-e2e.mjs · generar-catalogo-errores.mjs · generar-vectores.mjs · generar-plazos.mjs
            generar-rutas.mjs · generar-tokens.mjs · generar-iconos.mjs · generar-fuentes.py · generar-demo.mjs
            generar-textos.mjs · generar-recursos.mjs · comprobar-prohibidos.mjs · comparar-capturas.py
```

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
settings:
  base:
    SWIFT_VERSION: "6"                    # Swift 6.2 de Xcode 26.6; modo 6 = concurrencia estricta
    IPHONEOS_DEPLOYMENT_TARGET: "26.0"
    TARGETED_DEVICE_FAMILY: "1"           # iPhone (decisión 1)
    ENABLE_USER_SCRIPT_SANDBOXING: YES
    LOCALIZATION_PREFERS_STRING_CATALOGS: YES
    DEAD_CODE_STRIPPING: YES
    CODE_SIGN_STYLE: Automatic
    DEVELOPMENT_TEAM: ""
    # NO: SWIFT_DEFAULT_ACTOR_ISOLATION ni SWIFT_APPROACHABLE_CONCURRENCY (cambiarían la semántica del núcleo, a8 §3.4.3)
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
      - path: Paquetes/AceReglas/Sources/AceReglas   # mismas fuentes que el paquete Linux
        group: AceReglas
      - path: Resources
    settings:
      base:
        PRODUCT_NAME: AceNeo
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID)
        INFOPLIST_FILE: Config/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: AccentColor
        ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS: YES   # Image(.marca), Color(.bg) comprobados al compilar
        ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS: NO
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
      - path: Paquetes/AceReglas/Tests/AceReglasTests/Vectores   # los vectores también en iOS
        type: folder
        buildPhase: resources
    dependencies: [{ target: AceNeo }]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID).tests
        GENERATE_INFOPLIST_FILE: YES
        TEST_HOST: $(BUILT_PRODUCTS_DIR)/AceNeo.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/AceNeo
        BUNDLE_LOADER: $(TEST_HOST)
  AceNeoUITests:
    type: bundle.ui-testing
    platform: iOS
    sources:
      - path: Tests/AceNeoUITests
      - path: Sources/Armazon/IdentificadoresUI.swift   # los mismos identificadores en la app y en las pruebas
    dependencies: [{ target: AceNeo }]
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
    archive: { config: Release }
```

`Paquetes/AceReglas/Package.swift` (solo para Linux; Xcode no lo ve como paquete):

```swift
// swift-tools-version: 6.2
import PackageDescription
let package = Package(
    name: "AceReglas",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [.library(name: "AceReglas", targets: ["AceReglas"])],
    targets: [
        .target(name: "AceReglas"),
        .testTarget(name: "AceReglasTests", dependencies: ["AceReglas"], resources: [.copy("Vectores")]),
    ],
    swiftLanguageModes: [.v6]
)
```

Regla del paquete: **solo `import Foundation`** (ni `UIKit`, ni `SwiftUI`, ni `CoreGraphics`, ni `os`); tipos
`internal` y `Sendable`; nada de `NSRegularExpression` con opciones que Linux no tenga (usar `Regex` de Swift);
Unicode con `decomposedStringWithCanonicalMapping` + filtro U+0300–U+036F (a7 §14.2). Colores como
`struct RGB: Sendable { var r, g, b: Double }` (Palco los convierte a `Color`). Los tests usan `import Testing` y
`@testable import AceReglas`; en iOS, los mismos vectores los lee `AceNeoTests` (sin duplicar casos: basta un
test de humo que confirme que el módulo de la app da lo mismo).

### A.4 `Info.plist` (cambios respecto a hoy)

```xml
<key>UIAppFonts</key>
<array>
  <string>MonaSansPalco-Variable.ttf</string>   <!-- métricas normalizadas, §B.2 -->
  <string>MonaSans-Variable.ttf</string>        <!-- original, solo para campos de texto -->
  <string>MartianMono-Variable.ttf</string>
</array>
<key>UIBackgroundModes</key><array><string>audio</string></array>
<key>CFBundleURLTypes</key>            <!-- se queda: aceneo:// -->
<key>UIApplicationSceneManifest</key>
<dict>
  <key>UIApplicationSupportsMultipleScenes</key><false/>
  <key>UISceneConfigurations</key>
  <dict><key>UIWindowSceneSessionRoleApplication</key>
    <array><dict>
      <key>UISceneConfigurationName</key><string>Principal</string>
      <key>UISceneDelegateClassName</key><string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
    </dict></array>
  </dict>
</dict>
<key>UISupportedInterfaceOrientations</key>
<array><string>UIInterfaceOrientationPortrait</string>
       <string>UIInterfaceOrientationLandscapeLeft</string>
       <string>UIInterfaceOrientationLandscapeRight</string></array>
<!-- se quita UISupportedInterfaceOrientations~ipad; se quedan ATS, permisos, UILaunchScreen (Bg), ITSAppUsesNonExemptEncryption -->
```

`Config/AceNeo.xcconfig`: `MARKETING_VERSION = 0.8.1`, `ACE_BUNDLE_ID = es.ismaeloul.aceplayerneo`,
`ACE_DISPLAY_NAME = Ace Neo` (sin cambios de nombre ni de bundle id).

### A.5 Recursos generados (todos con `--check` en la CI)

| Script | Lee (web/monorepo) | Escribe | Qué comprueba el test de Swift |
|---|---|---|---|
| `generar-tokens.mjs` | `web/styles/tokens.css` (bloques hex claro y `[data-scheme='dark']`, a1 §0.1) + tabla de mezclas de a1 §2.3–§2.4 | `Sources/Palco/Tokens/ColoresPalco.generated.swift` | `TokensTests`: cada `Palco.<token>` resuelve el hex esperado en claro y oscuro (`UITraitCollection`) |
| `generar-iconos.mjs` | `web/ui/icons.ts` (`ICONS`), normaliza `rect/circle/path` como a1 §12 y convierte arcos `A/a` a cúbicas | `Sources/Palco/Iconos/IconosPalco.generated.swift` | `IconosTests`: 52 casos, `Icono.allCases.count == ICON_NAMES.count`, cajas de trazo dentro de 24×24 |
| `generar-fuentes.py` | `@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2`, `…/martian-mono-latin-wdth-normal.woff2` | `Resources/Fuentes/*.ttf` (binarios commiteados; el `--check` compara sha256 del origen y los parámetros) | `FuentesTests` (§B.2) |
| `generar-plazos.mjs` | `web/api/client.ts` (`TIMEOUTS`…), `web/features/sources/session.ts` (`RESOLVE_TIMEOUT_MS`, `RESEARCH_TIMEOUT_MS`) | `Nucleo/Red/PlazosWeb.generated.swift` | `EndpointTests`: plazo por ruta = tabla |
| `generar-rutas.mjs` | `packages/shared/src/routes.ts` (`V1_ROUTES`: id, método, ruta, `access`, credencial) | `Nucleo/Red/RutaID.generated.swift` | `RutasTests`: toda `enum API` tiene su `RutaID` y su acceso |
| `generar-catalogo-errores.mjs` (existe) | `packages/shared/src/errors.ts` | `Nucleo/Red/ErrorCatalog.swift` | el de hoy |
| `generar-textos.mjs` | literales de `notify(`/`toast(`/`setWaitingMessage(`/`fail(` en `web/player/runtime.ts`, `status.ts`, `features/sources/session.ts`, `notices/*` | `Paquetes/AceReglas/Tests/AceReglasTests/Vectores/textos-web.json` | `TextosTests`: cada texto de `AceReglas/Reproductor/Textos.swift` existe en el JSON (y viceversa, salvo la lista blanca de textos propios de la app) |
| `generar-vectores.mjs` (se amplía) | ejecuta el TS de verdad (`domain.ts`, `cards.ts`, `teams.ts`, `color.ts`, `sources/model.ts`, `library/model.ts`, `on-air.ts`, `zapping.ts`, `search/model.ts`, `directories/model.ts`, `preferences/model.ts`, `where-playing/model.ts`, `health/model.ts`, `devices/model.ts`, `player/status.ts`, `lib/gestures.ts`, `notices/toasts.ts`, `for-you.ts`, `channels.ts`, `hash.ts`) | `Paquetes/AceReglas/Tests/AceReglasTests/Vectores/<área>.json` | un test por área (§E.8) |
| `generar-demo.mjs` | módulos de demo de la web (§F.2) | `Sources/Simulado/Generado/SemillasDemo.generated.swift` + `Vectores/demo-*.json` | `SimuladoTests` (§F.3) |
| `generar-recursos.mjs` (existe) | `apps/web/public/icon.svg` | `Marca.imageset` (una variante); el `AppIcon` **no se regenera** (decisión 8) | — |

Todos los ficheros generados llevan cabecera `// GENERADO por scripts/<x>. No editar.` y **nunca usan cadenas
crudas** `#"…"#` (aprendizaje a8 §9.1): el JSON embebido va en base64 (`Data(base64Encoded:)`), los hex como
enteros `0xRRGGBB`.

---

## B. Sistema de diseño «Palco» en SwiftUI

### B.1 Color

- `ColoresPalco.generated.swift` define **cada token de a1 §2.1–§2.2** como `Color` dinámico sRGB, con los
  hex de la web (en oscuro, los del bloque hex, a1 §0.1):

```swift
extension Color {
    /// Resuelve claro/oscuro por el esquema del SUBÁRBOL (islas oscuras: .environment(\.colorScheme, .dark)).
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1) {
        self.init(uiColor: UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark
                ? UIColor(rgb: oscuro, alfa: alfaOscuro)
                : UIColor(rgb: claro, alfa: alfaClaro)
        })
    }
}
enum Palco {                                   // GENERADO
    static let bg        = Color(claro: 0xF3F3F4, oscuro: 0x05070A)
    static let surface   = Color(claro: 0xFFFFFF, oscuro: 0x0F1218)
    static let lineSoft  = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF, alfaClaro: 0.08, alfaOscuro: 0.10)
    static let accent    = Color(claro: 0xFFD60A, oscuro: 0xFFD60A)
    static let glassDense = Color(claro: 0xFFFFFF, oscuro: 0x161A22, alfaClaro: 0.90, alfaOscuro: 0.86)
    static let liveCapsula = Color(claro: 0xB1231A, oscuro: 0xD12E25)
    // … todos los de a1 §2.1, §2.2 y las mezclas de §2.3 ya resueltas
}
```

- **Islas oscuras** (a1 §0.2): `.islaOscura()` = `.environment(\.colorScheme, .dark)` en `TarjetaVersus`,
  cápsulas de cristal, `PastillaCompeticion`, todo lo que va sobre el vídeo, cabecera sobre el héroe, tarjeta
  de primer uso, cartel de cámara y cartel de canal.
- **Colores de club y de canal**: `AceReglas/Color/OKLab.swift` (port literal de `lib/color.ts`:
  `rgbToOklch`, `oklchToRgb`, `mixOklab`, `hueFromName` con FNV-1a sobre UTF-16) y `Equipos.swift`
  (`versusPair`, `teamLight`, `channelTone`, `nameTone`, `teamInitials`, `competitionShort`, `channelDorsal`,
  `channelAbbrev`) devuelven `RGB`; `Palco/Tokens/Colores.swift` los pasa a `Color(.sRGB, …)`. Vectores:
  `Vectores/color.json` (los 14 tonos de a7 §13.9 incluidos).
- En el catálogo solo `Bg` (lo pide `UILaunchScreen`) y `AccentColor` (`#FFD60A`, tinte de lo poco del sistema:
  menús, alertas, selector de AirPlay).

### B.2 Tipografía

**Fuentes**. `generar-fuentes.py` (fontTools + brotli, en un venv de la CI) convierte los woff2 de la web a
TTF variable y produce **dos** Mona Sans:

| Fichero | PostScript | Métricas | Para qué |
|---|---|---|---|
| `MonaSansPalco-Variable.ttf` | `MonaSansPalco-ExtraLight` (se renombra: dos fuentes con el mismo nombre no se pueden registrar) | `hhea.ascender = 885`, `hhea.descender = −115`, `lineGap = 0`; lo mismo en `OS/2` typo + `USE_TYPO_METRICS`; `usWin*` iguales | **todo el texto** (`Text`) |
| `MonaSans-Variable.ttf` | `MonaSans-ExtraLight` | originales (1090 / −320) | `TextField`, `UILabel` (nunca recortan acentos) |
| `MartianMono-Variable.ttf` | `MartianMono-SemiExpandedRegular` | originales | hashes, datos técnicos, URL de listas |

**Por qué 885/−115** (resuelve el riesgo n.º 1 de a1 §13.9 sin `UILabel`): con una caja de fuente de
**exactamente 1 em** cuyo centro está 0,385 em sobre la línea base —el mismo centro que la caja de contenido
CSS de Mona Sans ((1,09 − 0,32)/2)—, cualquier `line-height: lh` de la web se reproduce en SwiftUI, en una o en
varias líneas, con:

```swift
extension View {
    /// line-height CSS exacto: media interlínea arriba y abajo, y lh entre líneas base (lh ≥ 1).
    func altoDeLinea(_ lh: CGFloat, tamano: CGFloat) -> some View {
        self.lineSpacing((lh - 1) * tamano)
            .padding(.vertical, (lh - 1) * tamano / 2)
    }
}
```

(Línea base de la primera línea a `(lh−1)/2 + 0,885 = lh/2 + 0,385` em del borde, que es la de CSS; avance entre
líneas `1 + (lh−1) = lh`.) Todos los `lh` de la web son ≥ 1 (1 · 1,1 · 1,15 · 1,25 · 1,45). Los glifos siguen
dibujándose enteros (SwiftUI no recorta el `Text`); los campos usan la fuente original para que `UITextField`
no recorte. El spike (§G.5) lo valida superponiendo capturas; **plan B** si algo se recorta: el
`UILabel` con `min/maxLineHeight` de a1 §13.3.

**Fábrica única** (`Palco/Tokens/Tipografia.swift`):

```swift
@MainActor
enum Mona {
    enum Variante: Sendable { case palco, campos }
    /// SIEMPRE los dos ejes (el fichero pesa 200 por defecto, a1 §0.5). Caché por (tamaño, peso, anchura, variante).
    static func ctFont(_ tamano: CGFloat, peso: CGFloat, anchura: CGFloat = 100, variante: Variante = .palco) -> CTFont
    static func fuente(_ tamano: CGFloat, peso: CGFloat, anchura: CGFloat = 100, variante: Variante = .palco) -> Font
}
@MainActor
enum Martian {
    static func fuente(_ tamano: CGFloat, peso: CGFloat = 400, anchura: CGFloat = 87.5) -> Font
}
```

**Estilos** (`EstilosTexto.swift`, uno por fila de a1 §3.4 y los sueltos de a2–a6):

```swift
struct EstiloTexto: Hashable, Sendable {
    var tamano: CGFloat; var peso: CGFloat; var anchura: CGFloat = 100
    var trackingEm: CGFloat = 0; var lh: CGFloat = 1.45; var mayusculas = false
}
extension EstiloTexto {
    static let cuerpo        = EstiloTexto(tamano: 15, peso: 450)
    static let titularVista  = EstiloTexto(tamano: 30, peso: 800, anchura: 125, trackingEm: -0.02, lh: 1.1)
    static let titularVistaAncha = EstiloTexto(tamano: 44, peso: 800, anchura: 125, trackingEm: -0.02, lh: 1.1)
    static let tituloHoja    = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.01, lh: 1.25)
    static let kicker        = EstiloTexto(tamano: 13, peso: 700, trackingEm: 0.14, lh: 1.45, mayusculas: true)
    static let boton         = EstiloTexto(tamano: 15, peso: 650, lh: 1.1)
    static let pestanaBarra  = EstiloTexto(tamano: 11, peso: 620, anchura: 88, lh: 1.45)
    static let capsulaMd     = EstiloTexto(tamano: 13, peso: 640, anchura: 88, lh: 1)
    // … (≈ 40 estilos; la tabla vive en el fichero con la cita a1/a3/a4/a5/a6 de cada uno)
}
extension View {
    func estilo(_ e: EstiloTexto) -> some View   // fuente + .tracking(em×tamaño) + altoDeLinea + textCase(es_ES)
}
```

**Cifras (`Num`)**: `HStack(spacing: 0)` de segmentos de `splitDigits` (portado en `AceReglas/Formato`); cada
dígito en `.frame(width: celda × tamaño)` (0,49 condensado, 0,645 normal, 0,72 código de emparejar); separadores a
su ancho natural; `.accessibilityElement(children: .ignore)` + etiqueta entera.

```swift
struct Num: View {
    enum Animacion: Sendable { case ninguna, paleta, rueda }   // paleta = al destapar (web); rueda = al cambiar (decisión 3)
    let texto: String
    var tamano: CGFloat
    var condensado = true
    var etiqueta: String? = nil
    var animacion: Animacion = .ninguna
}
```

- `.rueda`: cada celda con `.contentTransition(.numericText(value: Double(digito)))` y la animación del muelle
  héroe; **dentro de la celda fija** (no cambia el ancho ni activa `tnum`).
- `.paleta`: `rotation3DEffect(.degrees(−90 → 0), axis: (1, 0, 0), perspective: 240/altura)` + opacidad, muelle
  héroe; rebote del gol con `keyframeAnimator` (1 → 1,14 → 1 en 0,72 s). Movimiento reducido: fundido 150 ms.
- Prohibidos en todo el proyecto (los busca `comprobar-prohibidos.mjs`): `.monospacedDigit()`,
  `.fontWeight(`, `.fontWidth(`, `.bold()`, `Font.custom(`, `.font(.body` y demás estilos del sistema,
  `@ScaledMetric`.

**Dynamic Type**: tamaños fijos, como Safari con la web (a2 §26). En la raíz `.font(Mona.fuente(15, peso: 450))`
para que nada caiga en `.body`. Añadido sin coste visual: `.accessibilityShowsLargeContentViewer()` en pestañas,
barra superior, controles del vídeo, `BotonIcono` y cápsulas. Negrita, contraste y formas de botón del sistema:
no se aplican (web). Reducir movimiento, preferir fundidos, reducir transparencia e invertir colores: sí
(`.accessibilityIgnoresInvertColors()` en vídeo, escudos, teselas, QR y cámara).

`FuentesTests`: `CTFontCopyPostScriptName == "MonaSansPalco-ExtraLight"`, `CTFontCopyVariation` = `{wght, wdth}`
pedidos, `CTFontGetAscent(t) == 0,885·t`, `CTFontGetDescent == 0,115·t`, anchos de avance de «4» a wdth 75/780 =
0,490 em (a1 §3.5).

### B.3 Iconos

- `IconosPalco.generated.swift`: `enum Icono: String, CaseIterable, Sendable { case agenda, biblioteca, buscar, … }`
  (52, con `starF = "star-f"`…) y dos `Path` estáticos por icono en coordenadas 24×24 (trazo y relleno),
  construidos **una vez** (`static let`); `func trazo(en rect: CGRect) -> Path` escala con `CGAffineTransform`.
- `IconoPalco(_ icono: Icono, tamano: CGFloat = 24, relleno: Bool = false)`: `stroke` con
  `StrokeStyle(lineWidth: 1,8·t/24, lineCap: .round, lineJoin: .round)`; `relleno: true` = relleno **y** trazo de
  la misma `Path` (pausa/reproducir grande, mini, «Toca para reproducir», a1 §10.1). `.accessibilityHidden(true)`
  salvo etiqueta. Nunca SF Symbols.
- `IconoImagen.imagen(_ icono: Icono, tamano: CGFloat = 20) -> Image` (`@MainActor`, `ImageRenderer` +
  caché + `.renderingMode(.template)`): el único modo de meter nuestros iconos en `Menu`/`.contextMenu`, que solo
  aceptan `Image` en sus `Label`.

### B.4 Espacio, radios, capas y sombras

- `Medidas.swift`: `enum S { s1 = 4 … s12 = 48, gutter = 16, tap = 44 }`, `enum R { xl = 24, l = 18, m = 14, s = 10, xs = 6 }`,
  `func radioInterior(_ exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(6, exterior − relleno) }`, capas
  `enum Z { velo = 39, barra = 40, mini = 41, toasts = 60, inmersivo = 100 }`, alturas de armazón
  (`barra 64`, `hueco 10`, `mini 72`, `barraSuperior 64`). Formas siempre `style: .circular` (a1 §13.4).
- `Sombras.swift`: sombras con **extensión negativa** dibujando la forma encogida detrás (a1 §5, a2 §21.5):

```swift
struct CapaSombra: Sendable { var color: Color; var x: CGFloat = 0; var y: CGFloat; var desenfoque: CGFloat; var extension_: CGFloat = 0 }
enum SombraPalco: Sendable { case uno, dos, cartel, hojaMovil, primario, gota, cristalVideo, pulgar }
extension View {
    /// Por cada capa: forma.inset(by: −extensión).fill(color).offset(x:y:).blur(radius: desenfoque/2), en .background, sin toques.
    func sombra<S: InsettableShape>(_ s: SombraPalco, en forma: S) -> some View
}
```

  Bordes interiores `inset 0 0 0 1` → `strokeBorder`; filo superior `inset 0 1 0` → `forma.subtracting(forma.offset(y: 1))`.

### B.5 Cristal (Liquid Glass)

```swift
enum MaterialCristal: Sendable { case regular, denso, video }
extension EnvironmentValues { @Entry var cristalReducido: Bool = false }   // sistema || «Reducir transparencia»
extension View {
    /// .glassEffect(.regular.tint(token), in:) con la sombra de la web; opaco con cristalReducido.
    func cristal<S: Shape>(_ material: MaterialCristal, en forma: S, interactivo: Bool = false) -> some View
}
```

| Pieza web | Clase web | SwiftUI iOS 26 | Opaco |
|---|---|---|---|
| Barra inferior, mini, toasts | `.glass--dense` | `.glassEffect(.regular.tint(Palco.glassDense), in: …)` (+ `.interactive()` en la barra y el mini) | `Palco.glassSolid` |
| Barra superior (horizontal) | `.glass` → al bajar > 32 pt, capa `--glass-dense` + filete | tinte `Palco.glass` → `Palco.glassDense` con fundido 340 ms | `glassSolid` |
| Cápsulas y controles del vídeo, ⌄, cápsula de estado, marcador sobre el vídeo, cápsulas de cristal de las tarjetas | `.glass--video`, `.capsule--glass` | isla oscura + `.glassEffect(.regular.tint(Palco.glassVideo), in: .capsule)`; los grupos (☆·AirPlay·PiP·⋯, ↺30·🔊, Directo·⛶) dentro de un `GlassEffectContainer(spacing: 8)` para que se fundan al aparecer | `Palco.glassVideoSolid` (`#0F1218`) |
| Botones `btn--video`, «Toca para reproducir» | `btn--video` | `.glassEffect(.clear.tint(.white.opacity(0.16)))` | `glassVideoSolid` |
| Menús y hojas | `.glass--dense` / `--glass-solid` | los del sistema (decisión 5) | los del sistema |

- **Corrección de la web** (a1 §0.7): con transparencia reducida, la cápsula `live` sigue `#D12E25` y la `gold`
  sigue oro; solo la neutra pasa a `#0F1218`.
- **Nunca cristal anidado**: un solo `glassEffect` por pieza; lo que va dentro es relleno opaco (la píldora de la
  barra, la gota).
- El tinte exacto (alfa del token) se calibra en el spike contra `agenda-390x844-*.png` y
  `agenda-390x844-claro-transparencia-reducida.png`; si el cristal de iOS se aparta demasiado del 86–90 % de la
  web en la barra, se sube el alfa del tinte (constante única en `Cristal.swift`).

### B.6 Movimiento

| Token web | SwiftUI | Reducido |
|---|---|---|
| `--ease-rapido` 340 ms | `.spring(duration: 0.25, bounce: 0)` | `.easeOut(duration: 0.12)` |
| `--ease-estandar` 520 ms | `.spring(duration: 0.4, bounce: 0.15)` | `.easeOut(duration: 0.15)` |
| `--ease-heroe` 800 ms | `.spring(duration: 0.55, bounce: 0.3)` | `.easeOut(duration: 0.15)` |
| progreso (heroe + curva estándar) | `.spring(duration: 0.615, bounce: 0.15)` | `.easeOut(duration: 0.15)` |
| `--ease-out` 320/340 ms | `.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)` (o 0.34) | igual |
| `ace-onda` 2 s, comprobando 1,4 s, giro 1,6 s, brillo 1,6 s, ecualizador 1,1 s | `TimelineView(.animation)` con la aritmética de a1 §13.5 (todas sincronizadas) | quietas |
| escalonado 36 ms × min(i,10) | `.transition(.opacity.combined(with: .offset(y: 8)))` + `delay` solo al insertar | solo fundido, sin retraso |

```swift
enum Muelle: Sendable { case rapido, estandar, heroe, progreso, salida }
extension Animation { static func palco(_ m: Muelle, reducido: Bool) -> Animation }
extension EnvironmentValues { @Entry var movimientoReducido: Bool = false }   // sistema || -AceNeoMovimientoReducido
struct EstiloPulsar: ButtonStyle { … }   // .press: escala 0,975 + velo currentColor 10 % con el muelle rápido
```

`accessibilityReduceMotion` es de solo lectura: la raíz calcula `movimientoReducido` (sistema **o** argumento de
Debug, para capturar `…-oscuro-movimiento-reducido.png`) y lo publica por entorno. Mejoras nativas con muelle
(decisión 3, siempre con su versión reducida): píldora de la barra que se **estira** al viajar (escala x 1 → 1,12 →
1 con `keyframeAnimator` sincronizado con el desplazamiento), mini que entra/sale con el muelle estándar, toasts
que **se recolocan con muelle** en lugar de saltar (a2 §20.8), segmentados y tira de días con la gota que viaja.

### B.7 Háptica

```swift
enum TipoHaptica: Sendable, Hashable { case seleccion, ligera, media, fuerte, rigida, exito, aviso, error }
@MainActor
enum Haptica {
    /// Anti-ráfaga: la misma sensación no se repite en < 40 ms; `.seleccion` se calla con movimiento reducido.
    static func permitir(_ t: TipoHaptica) -> Bool
    /// Imperativa (umbrales de gestos, fin de acciones async). Generadores preparados.
    static func disparar(_ t: TipoHaptica)
}
extension View {
    /// Declarativa: .sensoryFeedback(t.feedback, trigger: valor) { (a: T, b: T) -> Bool in Haptica.permitir(t) && condicion(a, b) }
    func haptica<T: Equatable>(_ t: TipoHaptica, al valor: T, si condicion: @escaping (T, T) -> Bool = { _, _ in true }) -> some View
}
```

- Se programa **la tabla por sitio de a1 §8.1** entera (las «= web» y las «añadido»: barra de pestañas
  `seleccion`, cerrar hoja arrastrando `media`, pulsación larga, emparejar `exito`/`error`).
- **Pulsación larga**: la vibración la da el propio `.contextMenu` del sistema; `Haptica` **no** añade la suya.
- Hojas nativas: `media` al cerrarlas **arrastrando** (se detecta con `onDisappear` + bandera «se cerró sin botón»).
- Nuevas por los gestos nativos (decisión 3): cruzar el umbral de «deslizar el vídeo a un lado» = `rigida` (la de
  cambiar de fuente), doble toque → pantalla completa = `media`, tirar para actualizar = `seleccion` al soltar
  (lo pone el sistema si lo hace; si no, nada).

### B.8 Componentes (primitivas de a1 §10)

| Web (`ui/`) | Swift (`Palco/Componentes/`) | Firma |
|---|---|---|
| `Button` | `Boton` | `Boton(_ titulo: String, icono: Icono? = nil, variante: VarianteBoton = .quiet, tamano: TamanoBoton = .md, pulsado: Bool = false, ocupado: Bool = false, bloque: Bool = false, accion: @escaping () -> Void)` |
| `IconButton` | `BotonIcono` | `BotonIcono(_ icono: Icono, etiqueta: String, variante: VarianteBoton = .ghost, pulsado: Bool = false, iconoPulsado: Icono? = nil, accion:)` |
| `Card` / `Panel` | `.tarjeta(radio:relleno:)` / `.panel(_ material:)` | publica `@Entry var radioInterior` |
| `Chip` | `Chip` | `Chip(_ texto: String, icono: Icono?, tono: TonoChip, contorno: Contorno?, contador: Int?, pulsado: Bool?, accion: (() -> Void)?)` |
| `Capsule` | `Capsula` | `Capsula(_ texto: String, tono: TonoCapsula, tamano: .md/.sm, punto: Bool, icono: Icono?, cristal: Bool)` |
| `SignalBadge` / `SignalRing` | `MedidorSenal` / `AnilloSenal` | estado `EstadoSenal` de `AceReglas` |
| `LiveDot`, `Num`, `ProgressBar` | `PuntoDirecto`, `Num`, `BarraProgreso` | — |
| `TeamMark`, `ChannelMark`, `CompetitionBadge`, `VersusCard` | `MarcaEquipo`, `MarcaCanal`, `PastillaCompeticion`, `TarjetaVersus` | `TarjetaVersus(_ datos: DatosVersus, tamano: .sm/.md/.lg/.xl, ancho: CGFloat)` (datos ya calculados por `AceReglas`) |
| `PosterRail` | `Carril` | `ScrollView(.horizontal)` + `LazyHStack(spacing: 12)` + `.scrollTargetLayout()` + `.scrollTargetBehavior(.viewAligned)` + `.contentMargins` + `.scrollClipDisabled()` |
| `Segmented` / `Tabs` | `Segmentado<Valor>` | gota opaca con `matchedGeometryEffect`, muelle estándar, `accessibilityRepresentation { Picker }` |
| `Switch` | `EstiloInterruptor: ToggleStyle` | 52×32, pulgar 26, muelle estándar |
| `TextField` | `CampoTexto` | fuente `.campos`, 16 pt, halo por `@FocusState` |
| `EmptyState`, `Skeleton` | `EstadoVacio`, `Esqueleto` | ilustración en `Canvas` (viewBox 120) |
| `ViewHeader`, `EngineIndicator` | `CabeceraVista`, `IndicadorMotor` | `CabeceraVista(titulo:subtitulo:ocultarMotor:acciones:)` con `Flujo` (Layout que parte en líneas) |
| `Menu` / `MenuButton` / `useContextMenu` | `MenuPalco` | §C.11 |
| `Sheet` | `ContenidoHoja` | §C.10 |
| `ToastView`, `StatusLineView` | `ToastVista`, `LineaEstadoVista` | §C.9 |
| `second-tap.ts` | `SegundoToque` (`@Observable`) | `armar(_ id:, plazo: Duration)`, `ejecutar(_ id:) -> Bool`, desarma al ocultar la vista |

Regla de tamaño para el type-checker: **ningún `body` de más de ~30 líneas ni más de ~10 modificadores
encadenados**; lo demás en subvistas o `@ViewBuilder private var`.

---

## C. Armazón

### C.1 Ciclo de vida y ventana

```swift
@main @MainActor final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ app: UIApplication, didFinishLaunchingWithOptions opciones: [UIApplication.LaunchOptionsKey: Any]?) -> Bool
    // MigracionClaves.ejecutar() ANTES de leer cualquier @AppStorage; AVAudioSession(.playback, .moviePlayback, .longFormVideo)
}
@MainActor final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ s: UIScene, willConnectTo sesion: UISceneSession, options: UIScene.ConnectionOptions)  // crea HostingPalco; enlaces aceneo:// en frío
    func scene(_ s: UIScene, openURLContexts contextos: Set<UIOpenURLContext>)                          // en caliente
    func sceneDidBecomeActive(_ s: UIScene); func sceneDidEnterBackground(_ s: UIScene)                   // → SesionApp
}
/// Estado que SwiftUI no puede fijar por pantalla sin un controlador propio.
@MainActor @Observable final class EstadoVentana {
    var estiloBarraEstado: UIStatusBarStyle = .default   // .lightContent sobre héroe/vídeo (a3 §4.7)
    var barraEstadoOculta = false                         // inmersivo
    var ocultarIndicadorInicio = false                    // inmersivo
    var orientaciones: UIInterfaceOrientationMask = [.portrait, .landscape]
    var bordesDiferidos: UIRectEdge = []                  // inmersivo: .all
}
final class HostingPalco: UIHostingController<RaizView> {
    // overrides: preferredStatusBarStyle, prefersStatusBarHidden, prefersHomeIndicatorAutoHidden,
    // supportedInterfaceOrientations, preferredScreenEdgesDeferringSystemGestures;
    // un bucle `for await _ in Observations { estado.… }` llama a setNeeds…Update().
}
```

`@Environment(\.scenePhase)` sigue llegando dentro del `UIHostingController`; los enlaces llegan por el
`SceneDelegate` a `SesionApp.abrir(enlace:)` (no `onOpenURL`).

### C.2 Raíz: emparejar ↔ app

`RaizView` = a2 §27.2 tal cual: las dos capas montadas a la vez durante el paso, animando la **opacidad de un
contenedor ya montado** (nunca un `if/else` dentro de `withAnimation`, a8 §9.6); éxito con la secuencia de a2 §22.6
(600 ms + fundido 340 ms + toast «Emparejado con {host}»); acceso perdido con la de a2 §23.3 y a9 §3.5.

```swift
enum FaseRaiz: Equatable, Sendable { case emparejar(MotivoEmparejar?), app }
enum MotivoEmparejar: Equatable, Sendable { case olvidado, revocadoDesdeOtro, noAutorizado, llavero, olvidadoLocal }
```

### C.3 `AppShell` y sus capas

```swift
struct AppShell: View {
    // ZStack(alignment: .bottom), de atrás a delante:
    //  Palco.bg.ignoresSafeArea()
    //  CapaPestanas()                         pestañas visitadas, cada una con su NavigationStack (C.5)
    //  VeloInferior()      .zIndex(39)        solo con barra inferior visible
    //  BarraPestanas()     .zIndex(40)        móvil y fuera del teatro
    //  CapaMini()          .zIndex(41)        algo suena y la ruta visible no es el teatro
    //  CapaAvisos()        .zIndex(60)        toasts (nunca en inmersivo)
    //  CapaInmersiva()     .zIndex(100)       teatro + teléfono horizontal, o ⛶ forzado
    // .overlay(alignment: .top) { BarraSuperior() }   tableta (≥ 768) y no inmersivo
    // .sheet(item: $hojas.actual) { HojaRaiz($0) }     C.10
    // .ignoresSafeArea(.keyboard)                      la barra y el mini no suben con el teclado (web)
    // .onGeometryChange(for: ShellLayout.self) → entorno  (lee tamaño y zonas seguras de una vista que NO ignora el área segura)
}
```

`CapaInmersiva` está **fuera** del `NavigationStack`: así ningún gesto del sistema (volver desde el borde, zoom
hacia abajo) puede dispararse en inmersivo (a2 §2.4), y su hueco de vídeo tiene la prioridad más alta.

### C.4 `ShellLayout` y valores de entorno

```swift
struct ShellLayout: Equatable, Sendable {
    var tamano: CGSize; var seguras: EdgeInsets
    enum Tipo: Sendable { case movil, tableta }
    var tipo: Tipo { tamano.width < 768 ? .movil : .tableta }
    var telefonoHorizontal: Bool { tamano.width > tamano.height && tamano.height <= 540 }
    var estrecho: Bool { tamano.width <= 380 }
    var altoVentana: CGFloat { tamano.height + seguras.top + seguras.bottom }
    var altoHeroe: CGFloat { min(500, max(360, 0.6 * altoVentana)) }          // a3 §4.7
    func inmersivo(teatroVisible: Bool, forzado: Bool) -> Bool { forzado || (teatroVisible && telefonoHorizontal) }
    func barraInferior(teatroVisible: Bool, inmersivo: Bool) -> Bool { tipo == .movil && !teatroVisible && !inmersivo }
    func marcoMini(barra: Bool) -> CGRect                 // a2 §7 / §16.3
    func bordeInferiorToasts(barra: Bool, mini: Bool) -> CGFloat   // a1 §10.20
    func rellenoInferiorContenido(mini: Bool, teatro: Bool) -> CGFloat
    var celdaBarra: CGFloat { (tamano.width - seguras.leading - seguras.trailing - 24 - 14) / 4 }
}
extension EnvironmentValues {
    @Entry var shell = ShellLayout(tamano: CGSize(width: 390, height: 844), seguras: EdgeInsets())
    @Entry var vistaActiva = true          // pestaña activa && scenePhase == .active: pausa consultas y relojes
    @Entry var modoDemo = false
    @Entry var espacioZoom: Namespace.ID? = nil
}
```

`ShellLayout` es **puro** (sus fórmulas se prueban en `ShellLayoutTests` con 390×844, 375×667, 375×812, 402×874,
844×390, 667×375 y las zonas seguras de a3 §4.7). Umbrales siempre con los números del CSS (`<= 380`, `< 768`,
`<= 540`), nunca `horizontalSizeClass`. Las consultas de contenedor (`@container`) miden **la caja** con
`onGeometryChange(for: CGFloat.self) { $0.size.width }`.

### C.5 Navegación y ruta (equivalente de `?vista=`)

```swift
enum Pestana: String, CaseIterable, Identifiable, Sendable { case agenda, canales = "biblioteca", buscar, ajustes }
enum SeccionAjustes: String, CaseIterable, Sendable { case listas, futbol, reproduccion, donde, apariencia, dispositivos, servidor, salud, motor, acerca }
enum OrigenZoom: String, Hashable, Sendable { case heroe, fila, cartel, filaCanal, resultado, mini, ninguno }
enum Ruta: Hashable, Sendable {
    case partido(id: String, desde: OrigenZoom)
    case canal(hash: String, desde: OrigenZoom)
    case sistema
    var idZoom: String   // "\(desde.rawValue)-\(id|hash)" = el id de matchedTransitionSource del origen
}
@MainActor @Observable final class Navegador {
    private(set) var pestana: Pestana = .agenda
    var pilas: [Pestana: [Ruta]] = [:]
    private(set) var visitadas: Set<Pestana> = [.agenda]
    private(set) var sentido: Sentido = .adelante            // por profundidad, a2 §2.2
    var seccionAjustes: SeccionAjustes?
    private(set) var subirArriba: [Pestana: Int] = [:]      // contador que escuchan los ScrollView
    var rutaVisible: Ruta? { pilas[pestana]?.last }
    var teatroVisible: Bool
    func ir(a destino: Pestana)                // no-op si es la misma (web)
    func tocarPestana(_ p: Pestana)            // si es la activa: pila → raíz, o subir arriba (decisión 3)
    func abrir(_ r: Ruta)                      // cierra cualquier otro teatro de otra pila (solo hay uno)
    func atras()                               // saca de la pila; sin pila → agenda
    func vista() -> String                     // "agenda", "biblioteca", "ajustes/salud", "partido/demo-1", "partido/canal/<hash>"
    static func desdeVista(_ v: String) -> (Pestana, [Ruta], SeccionAjustes?)   // -AceNeoVista y pruebas
}
```

- **Pestañas vivas**: `CapaPestanas` = `ZStack { ForEach(visitadas) { PilaPestana($0).opacity(activa ? 1 : 0)
  .offset(x: entrada).allowsHitTesting(activa).accessibilityHidden(!activa) } }` con el fundido + ±16 pt de la web
  (a2 §21.2). Cada pestaña conserva su scroll sola.
- **Pila por pestaña**: `NavigationStack(path: pilaEnlazada(p))` con `.toolbar(.hidden, for: .navigationBar)` en
  la raíz y en el destino; `.navigationDestination(for: Ruta.self) { TeatroView(ruta: $0).navigationTransition(
  .zoom(sourceID: $0.idZoom, in: ns)) }`.
- **Orígenes del zoom** (`.matchedTransitionSource(id:in:)`, con `clipShape` del radio de cada uno): bloque de
  escudos del héroe (`heroe`), `TarjetaPartido` (`fila`), cartel de «Emitiendo ahora» (`cartel`), `FilaCanal`
  (`filaCanal`), fila de resultado de Buscar (`resultado`), mini (`mini`). Abrir desde el mini hace que
  **arrastrar hacia abajo vuelva a encoger el vídeo en el mini**. Si el origen no existe (enlace de prueba), el
  zoom cae en su animación por defecto.
- Un solo teatro vivo: `abrir` quita el teatro de cualquier otra pila; el partido distinto empieza arriba
  (`.id(ruta)` en su `ScrollView`).
- La galería «Sistema» es `Ruta.sistema` (se empuja con la transición por defecto).

### C.6 Barra de pestañas (Liquid Glass)

```swift
struct BarraPestanas: View {
    // 64 de alto; 12 + zona segura a los lados; safeB + 10 abajo; radio 24 circular.
    // Fondo: .cristal(.denso, en: .rect(cornerRadius: 24), interactivo: true) + sombra --shadow-2 (extensión −20).
    // Píldora: RoundedRectangle(18).fill(Palco.accentWash), 50 de alto, ancho = celda, en x = 7 + i·celda,
    //   .animation(.palco(.estandar)) + estiramiento keyframe al viajar. Sin cristal (no se anida).
    // 4 × ItemPestana: IconoPalco 24 + Text 11/620/88, color accentInk/text2; sin efecto al pulsar (web).
    // .haptica(.seleccion, al: nav.pestana); accesibilidad «Principal», rasgo .isSelected en la activa;
    // .accessibilityShowsLargeContentViewer().
}
```

Oculta (fundido 340 ms) en el teatro, en inmersivo y con la pantalla de emparejar. No se pliega con el scroll.

### C.7 Barra superior (horizontal ≥ 768)

`BarraSuperior`: 64 + safeT (se calca 64, a2 §20.1), rejilla `1fr · auto · 1fr` (un `Layout` que centra el grupo),
marca 28×28 radio 8 (`Image(.marca)`) sin nombre (768–1023), 4 destinos de 104 (icono 20 + 13/620/88), píldora
`Capsule` 104×44 con el muelle estándar, a la derecha el rayo del motor sin texto y «?» (hoja «Atajos de teclado»).
Cristal `regular` → `denso` + filete cuando la pestaña activa ha bajado > 32 pt (`onScrollGeometryChange(for:
Bool.self)` publicado por la pestaña en `Navegador.desplazada[pestana]`). **Corrección**: el contenido suma `safeL`.

### C.8 Cabecera de vista y velo

- `CabeceraVista` (a2 §6, §21.9) dentro del `ScrollView` de cada pantalla (no fija): relleno `safeT + 20` (≥ 768:
  24), título 30/44 una línea, «Modo demo» o `IndicadorMotor` (texto oculto ≤ 380, `accessibilityLabel` completo),
  acciones 44×44. Foco de VoiceOver al título al cambiar de vista (`@AccessibilityFocusState`).
- `VeloInferior`: `LinearGradient(stops: [bg 0, bg .58, bg.opacity(0) 1], startPoint: .bottom, endPoint: .top)`,
  alto `safeB + 100` (o `+ 180` con mini), `allowsHitTesting(false)`.

### C.9 Avisos: toasts y línea de estado

Lógica pura en `AceReglas/Avisos` (`ColaToasts`: máx. 2, 2,8 s, 6 s con «Deshacer», «×n», salida 320 ms;
`LineaEstado`: uno a la vez, 4,5 s, «×n», estado base) + adaptador observable:

```swift
enum TonoAviso: String, Sendable { case ok, info, warn, err }
enum ClaseAviso: Sendable { case accion, senal }
struct AccionAviso: Sendable { let titulo: String; let hacer: @MainActor @Sendable () -> Void }
@MainActor @Observable final class Avisos {
    private(set) var toasts: [ToastPalco]
    private(set) var linea: AvisoLinea?
    var estadoBase: EstadoBaseLinea?       // lo pone el reproductor (AceReglas/Reproductor/EstadoBase)
    var viendoTeatro = false               // clase .senal sin acción → línea de estado; si no, toast
    func avisar(_ texto: String, clase: ClaseAviso = .accion, tono: TonoAviso = .info, icono: Icono? = nil,
                medidor: EstadoSenal? = nil, dato: String? = nil, accion: AccionAviso? = nil, duracion: Duration? = nil)
    func cerrar(_ id: ToastPalco.ID)
    func vaciarLinea()
}
```

- **Posición** (`CapaAvisos`, de `ShellLayout.bordeInferiorToasts`): vertical `safeB + 94` (barra), `safeB + 178`
  (barra + mini), `safeB + 12` (teatro); lados 12 + zona segura; separación 8; ancho `min(420, …)`. Horizontal:
  abajo a la derecha, `safeR + 20` / `safeB + 20`, ancho `min(420, w − 40)`; con mini y 768 ≤ w ≤ 919, `safeB + 104`.
  Inmersivo: opacidad 0 y sin toques (se siguen anunciando).
- Toast: `.cristal(.denso, en: .rect(cornerRadius: 26))`, 52 mín., texto 15/560 lh 1,25, «Deshacer» `accentInk`,
  ✕ solo con acción. Entrada opacidad + `offset(y: 12)` + escala 0,98 (muelle estándar), salida opacidad + 6 pt
  (320 ms). Mejora: los demás se recolocan con muelle.
- Cada aviso nuevo → `AccessibilityNotification.Announcement(texto).post()`.
- Línea de estado sobre el vídeo: `CapsulaEstadoVideo` (§D.5).

### C.10 Hojas nativas con el contenido de la web

```swift
enum Hoja: Identifiable, Hashable, Sendable {
    case gustos, pegar(DestinoPegar), reportar(hash: String), encontrarCanal, guardarFavorito(RefCanal),
         renombrar(RefCanal), datosTecnicos, ayuda, otroServidor(PairingLink)
    var id: String
}
@MainActor @Observable final class CentroHojas {
    var actual: Hoja?
    func abrir(_ h: Hoja)      // cierra menús; con una hoja abierta, sustituye (la web no apila)
    func cerrar(conBoton: Bool)
}
struct ContenidoHoja<Cuerpo: View, Pie: View>: View {
    // Cabecera de la web (título 22/800/125 + BotonIcono ✕ «Cerrar»), descripción 15 --text-2,
    // cuerpo ScrollView (relleno 16 20 20), pie en .safeAreaInset(edge: .bottom) con filete --line-soft.
    init(titulo: String, descripcion: String? = nil, cerrable: Bool = true, @ViewBuilder cuerpo: () -> Cuerpo, @ViewBuilder pie: () -> Pie)
}
```

| Hoja (web) | Tamaño web | Detents | Notas |
|---|---|---|---|
| «¿Qué fútbol te mueve?» | lg | `[.large]` | foco inicial en «LaLiga»; «Guardar y ver mi agenda» en el pie |
| «Reproducir otro hash» | sm | `[.height(medida)]` (medida con `onGeometryChange`) | `PasteButton` «Pegar del portapapeles» (sin aviso del sistema) |
| «Reportar fuente» | sm | `[.height(medida)]` | radios de motivo propios |
| «Encontrar canal» | md | `[.medium, .large]` | se abre sola en `choices/not_found` |
| «Guardar favorito», «Renombrar canal» | sm | `[.height(medida)]` | campo con foco inicial |
| «Datos técnicos» (vertical sin pestaña) | sm | `[.medium]` | en inmersivo la web pinta un **panel sobre el vídeo**, no una hoja: se calca el panel |
| «Atajos de teclado» (Ayuda) | md | `[.large]` | solo «Gestos» si no hay teclado físico |
| «¿Emparejar con otro servidor?» | sm | `[.height(medida)]` | «Emparejar de nuevo» `danger` |

Comunes: `.presentationDragIndicator(.visible)` (el asa), fondo y esquinas **del sistema** (Liquid Glass de iOS 26
en alturas parciales; es la hoja nativa que pidió Isma), `.presentationContentInteraction(.scrolls)`,
`.interactiveDismissDisabled(ocupado)`. En horizontal, iOS presenta a su manera (sin diálogo de 560): aceptado.
Accesibilidad: título como encabezado, `accessibilityAction(.escape)` gratis del sistema.

### C.11 Menús nativos con el contenido de la web

```swift
struct ElementoMenu: Identifiable, Sendable {
    let id: String; let titulo: String; let icono: Icono?
    var peligro = false; var marcado: Bool? = nil; var deshabilitado = false; var separadoAntes = false
    var haptica: TipoHaptica? = nil                 // la de la web al ELEGIR (a4 §5.7): rígida en «Detener»…
    let accion: @MainActor @Sendable () -> Void
}
struct MenuPalco: View { let elementos: [ElementoMenu] }   // Section por separador; Button(role: .destructive); Toggle para marcables
extension View {
    /// .contextMenu(menuItems:preview:) + las mismas opciones como accessibilityActions (mismo orden y texto).
    func menuContextual<V: View>(_ elementos: @escaping @MainActor () -> [ElementoMenu], @ViewBuilder vistaPrevia: () -> V) -> some View
}
```

| Sitio | Menú | Vista previa |
|---|---|---|
| Tarjeta de partido (agenda) | `menuFor` de a3 §6.5 | la `TarjetaVersus` md a 240 |
| Fila de canal / cartel | a5 §3.9 | tesela + nombre |
| Cartel de fuente | a4 §12.6 «Fuente {n}» | el cartel |
| Vídeo (pulsación larga) y ⋯ «Más opciones» | a4 §5.6 (14 opciones; `Menu` en ⋯) | tesela del canal + título (una instantánea de `AVPlayerLayer` sale negra) |
| Fila de dispositivo | a6 §8.9 / §8.10.2 | la fila |
| Cambiar de lista (Canales › Listas) | `Menu` «Listas guardadas» | — |
| Inspector «Abrir en…» | `Menu` | — |

Iconos con `IconoImagen`. El menú del sistema respeta zonas seguras y se desplaza solo (corrige los fallos de la
web de a2 §20.3 y a4 §5.7).

### C.12 Scroll: memoria, subir arriba, tirar para actualizar

- Memoria: cada pestaña y cada teatro tienen su `ScrollView` vivo; nada que guardar.
- `.scrollPosition($posicion)` en cada pantalla; `onChange(of: nav.subirArriba[p])` →
  `withAnimation(.palco(.estandar, …)) { posicion.scrollTo(edge: .top) }` (tocar la pestaña activa).
- Barra de estado: la sonda `SubeConLaBarra` de a2 §27.5 (una sola `UIScrollView` con `scrollsToTop = true`: la de
  la pestaña o el teatro visible; carriles siempre `false`).
- `.refreshable { await agenda.recargar() }` solo en la Agenda (decisión 3); el botón ⟳ de la web se queda.
- Efecto de borde de iOS 26: sin barras del sistema no debería aparecer; si aparece sobre el héroe, se quita
  (modificador de efecto de borde del SDK 26.5, verificar nombre en el spike).

### C.13 Horizontal y iPhone SE

- ≥ 768 (todos salvo el SE): `BarraSuperior`, titulares 44, carriles de 300, mini en tarjeta abajo a la
  izquierda (440), toasts a la derecha, reglas por pantalla de a3 §12, a5 §3.11, a6 §15, emparejar en dos
  columnas (a2 §22.7). Teatro → inmersivo (§D.7).
- SE horizontal (667×375): maquetación móvil + `telefonoHorizontal` (héroe 360, controles «compactos» con ⌄),
  a2 §16.6.
- Giro en caliente: se conserva todo; una hoja abierta la re-presenta el sistema.

### C.14 Zonas seguras y teclado

- El contenido nunca ignora el área segura; solo los fondos (`.background { color.ignoresSafeArea() }`), el héroe
  (a sangre bajo la barra de estado, con la cabecera a `safeT + 20`) y el vídeo del teatro (franja negra `safeT`).
- `ShellLayout.seguras` se lee de una vista de fondo que **no** lleva `.ignoresSafeArea()` (a8 §9.3); nunca de un
  `GeometryReader` que la ignore.
- Horizontal: `safeL`/`safeR` en todo el contenido (corrige a2 §20.2).
- Teclado: `.ignoresSafeArea(.keyboard)` en `AppShell` (la barra no sube); las hojas nativas lo gestionan solas;
  Canales/Buscar `.scrollDismissesKeyboard(.never)` (a5 §2.14), Ajustes `.interactively`.

### C.15 Tema, transparencia y claves

`@AppStorage(Claves.tema)` (`aceneo-tema`: `sistema|claro|oscuro`) → `.preferredColorScheme` en `RaizView`;
`@AppStorage(Claves.transparencia)` (`aceneo-transparencia`) || `accessibilityReduceTransparency` →
`cristalReducido`; `@AppStorage(Claves.modo)` (`aceneo-pb`). `MigracionClaves` de a1 §13.10 en `AppDelegate`.
Argumentos de Debug `-aceneo-tema oscuro`, `-aceneo-transparencia reducida` (el dominio de argumentos pisa
`@AppStorage`).

### C.16 Estados globales

`EstadosGlobales.swift`: sin servidor al arrancar (toast warn 4 s «Backend no disponible; la app seguirá
reintentando», motor «Motor sin respuesta»); acceso perdido (`SesionApp.accesoPerdido(_:)`, una vez, orden de a2
§23.3 / a9 §3.5.2); revocado por SSE (con la bandera `olvidando`, a9 §3.5.3); servidor 0.8.0 (`Capacidades`, §E.6).

---

## D. Reproductor

### D.1 Piezas y dueño

| Pieza | Fichero | Tipo | Vive | Port de |
|---|---|---|---|---|
| Motor AVPlayer | `Reproduccion/MotorAVPlayer.swift` | `@MainActor final class: MotorVideo` | proceso | — (existe; primer fotograma con `isReadyForDisplay` + 0,05 s, a8 §3.11.7) |
| Máquina de conexión | `MaquinaConexion.swift` | `struct` | — | `player/machine.ts` (existe) |
| Reproductor | `Reproductor.swift` | `@MainActor @Observable` | proceso | `player/runtime.ts` (existe; textos de a8 §3.11.8; **sin** estado de presentación) |
| Sesión de fuentes | `SesionFuentes.swift` | `@MainActor @Observable` | proceso | `features/sources/session.ts` (entero) |
| Presentación | `PresentacionReproductor.swift` | `@MainActor @Observable` | proceso | `player/index.tsx`, `stage-slot.ts`, `screen.ts` |
| Superficie única + PiP + AirPlay | `SuperficieVideo.swift` | existe | proceso | `stage-slot.ts` |
| Pantalla de bloqueo | `ControlesSistema.swift` | existe (metadatos y comandos de a8 §3.11.6) | proceso | `player/media-session.ts` |
| Reglas de estado/textos | `AceReglas/Reproductor/*` | funciones puras | — | `player/status.ts`, `constants.ts` |

### D.2 Una sola `AVPlayerLayer`

```swift
public enum PrioridadHueco: Int, Sendable, Comparable { case mini = 1, teatro = 3, inmersivo = 4 }
struct VistaVideo: UIViewRepresentable { let superficie: SuperficieVideo; var prioridad: PrioridadHueco; var gravedad: AVLayerVideoGravity = .resizeAspect }
```

- Huecos: `EscenarioVideo` (teatro, `.teatro`), `MiniReproductor` (96×54, `.mini`), `CapaInmersiva` (`.inmersivo`,
  `.resizeAspect` sobre negro). La capa va al hueco en ventana de más prioridad (lo de hoy).
- La web no pinta vídeo en la portada de la agenda, así que no hay hueco «portada» («nada que la web no tenga»);
  el `enum` deja libre el 2 por si se decide.
- Durante el zoom interactivo de salida, el hueco del teatro sigue en la ventana (el vídeo se encoge con él);
  al completar la vuelta, el mini recibe la capa. Si se cancela, no pasa nada.
- En segundo plano sin PiP, `GestorPiP.pasoASegundoPlano()` suelta el `player` de la capa (audio sigue).

### D.3 Máquina de estados y textos

- Conexión (`MaquinaConexion`, ya port de `machine.ts`) y fase pública `FaseReproductor.derivar` (ya existe).
- Textos **exactos** de la web en `AceReglas/Reproductor`:
  - `EstadoBase.para(fase:, mensaje:, intento:, lead:, directo:, demo:) -> EstadoBaseLinea` = `statusFor` (a7 §9.7);
  - `MensajeEscenario.para(...)` = `stageMessage` (a4 §8.1);
  - `BotonDirecto.para(...)` = `liveButton` (a4 §5.4);
  - `Textos` = motivos de reconexión, reposo (`IDLE_MESSAGES`), avisos de directo/−30 s, traspaso, `stream.*`.
  Vectores `reproductor.json` + `textos-web.json` (§A.5).

### D.4 Sesión de fuentes

```swift
@MainActor @Observable final class SesionFuentes {
    enum Fase: Sendable { case idle, resolving, ready, choices, notFound, noChannels }
    private(set) var clave: String?                  // "m:<id>" | "c:<hash>"
    private(set) var fase: Fase
    private(set) var entradas: [EntradaFuente]
    private(set) var activa: String?
    private(set) var trabajo: ScanJob?
    private(set) var automatico: Bool; private(set) var saltoArmado: Bool; private(set) var eleccionManual: Bool
    private(set) var rebuscando: Bool; private(set) var detenida: Bool; private(set) var textoFallo: String?
    var esperando: String?                           // «Buscando fuentes…», «Comprobando N fuentes…» (panel «Buscando señal»)
    init(api: APIClient, reproductor: Reproductor, avisos: Avisos, hojas: CentroHojas, tiempoReal: EstadoTiempoRealLector, reloj: any Reloj, visor: String)
    func entrarPartido(_ m: FootballMatch)
    func entrarCanal(hash: String, titulo: String?, hermanas: [Item], listaActiva: String?)
    func salirVista()
    func elegir(_ hash: String)
    func paso(_ direccion: Int, visibles: [String])
    func pegar(_ texto: String) -> Bool
    func rebuscar() async
    func reportar(_ hash: String, motivo: SourceReportReason) async
    func confirmar(_ hash: String) async
    func elegirCandidata(_ c: ResolutionCandidate, recordar: Bool) async
    func vincularManual(_ texto: String) async -> String?        // error de campo o nil
    func procesar(_ evento: SSEEvent)                            // scan.progress / scan.verdict
    func alFallarFuente(_ fallo: FalloFuente) -> RespuestaFallo  // enganche del Reproductor (handleSourceFailed)
}
```

Constantes y reglas de a4 §20 / a7 §10 (3 min, 30 min, 60 s, 1,5 s, 3 fallos, 32 consultas / 31 min, 20/30 s,
1 reconexión en automático antes de la primera imagen). La lógica que no toca red (`pickAutoSource`,
`effectiveOf`, `isShownWhileScanning`, `failureVerdict`, textos de progreso) está en `AceReglas/Fuentes` con
vectores; `SesionFuentes` solo orquesta. Tests: port de `session.test.ts` (716 líneas) con `APIClient` sobre
`MockURLProtocol` y reloj inyectado; los dos de `CentroPartidoTests` se conservan.

### D.5 Presentación del reproductor y gestos

```swift
@MainActor @Observable final class PresentacionReproductor {
    enum Lugar: Sendable { case ninguno, teatro, mini, inmersivo }
    private(set) var lugar: Lugar
    private(set) var controlesVisibles = true
    var pantallaCompletaForzada = false              // ⛶
    var datosTecnicosAbiertos = false
    func tocarVideo()                                // alterna controles; rearma 3,2 s solo en .reproduciendo
    func dobleToque()                                // ⛶ (decisión 3)
    func interaccionConControles()                   // rearma el plazo; con VoiceOver nunca se ocultan (a4 §5.7)
    func alternarPantallaCompleta(escena: UIWindowScene)   // requestGeometryUpdate(.landscapeRight | .portrait), a2 §27.8
}
```

| Gesto (teatro vertical) | Reconocimiento | Efecto | Háptica |
|---|---|---|---|
| Tocar el vídeo | `SpatialTapGesture(count: 1)` que **no** espera al doble toque más de 190 ms (`CLICK_DELAY_MS` de la web) | alterna controles | — |
| Doble toque | `TapGesture(count: 2)` en `simultaneousGesture` | ⛶ (gira a horizontal inmersivo) | `media` |
| Arrastrar hacia abajo | zoom interactivo del sistema (§C.5) | minimiza (sale del teatro; el vídeo pasa al mini) | `ligera` al completar |
| Deslizar desde el borde izquierdo | zoom interactivo del sistema | igual que ⌄ | `ligera` |
| Deslizar el vídeo a los lados | `UIGestureRecognizerRepresentable` con `UIPanGestureRecognizer` que solo empieza en horizontal (eje bloqueado a 8 pt, `classifySwipe` 56 pt / 450 pt/s) y exige que falle el de borde | fuente anterior/siguiente de las visibles (`SesionFuentes.paso`), el vídeo se desplaza `clamp(dx/3, ±60)` mientras y hace el corte a negro al cambiar | `rigida` al cruzar el umbral |
| Pulsación larga | `.contextMenu` del sistema (vista previa: tesela + título) | menú «Opciones del reproductor» | la del sistema |
| «Emitiendo» ‹ › y deslizar | `BarraEmitiendo` (a4 §12.5) | igual que arriba | `rigida` |

`GestosVideo.swift` monta los reconocedores; los umbrales vienen de `AceReglas/Gestos` (probados en Linux). En
inmersivo no hay gestos de minimizar ni de borde (la capa está fuera de la pila, §C.3).

### D.6 PiP, AirPlay, pantalla de bloqueo y segundo plano

- **PiP**: `GestorPiP` de hoy (`canStartPictureInPictureAutomaticallyFromInline = true`); al empezar, si el teatro
  está a la vista, se minimiza (`Navegador.atras()`); al restaurar, se abre el teatro con origen `mini` y **solo
  después** se completa la restauración (hoy ya es así).
- **AirPlay** (decisión 6): `BotonAirPlay` (`AVRoutePickerView`, `prioritizesVideoDevices`) dentro de la cápsula
  ☆ · AirPlay · PiP · ⋯, **solo si `AVRouteDetector.multipleRoutesDetected`**; con el vídeo < 400 de ancho, el
  minuto de la cápsula del marcador cede su sitio (la misma salida que la web usa por debajo de 370, a4 §4.1).
- **Pantalla de bloqueo** (a8 §3.11.6): título = canal ‖ «Ace Player Neo»; artista = subtítulo («Fuente 1,
  Elcano») ‖ «Ace Player Neo»; álbum «Ace Player Neo»; carátula `Marca` oscura; `IsLiveStream`; comandos play,
  pause, toggle, **stop**, **−30 s** (`preferredIntervals = [30]`), anterior/siguiente solo con zapping;
  `nowPlayingInfo = nil` en idle/error.
- **Segundo plano**: `AVAudioSession(.playback)`; si suena algo, latido y SSE siguen mientras iOS lo permita; si
  no, se cierran SSE y sondeos (a7 §14.2); bajas pendientes dentro de `beginBackgroundTask`.
- **Interrupciones y rutas**: lo de hoy (`ControlesSistema`).
- **Red casa/Tailscale**: `VigiaRed` (`NWPathMonitor`) → `ServerResolver.invalidar()` → el SSE se reconecta con
  `Last-Event-ID`; si suena algo, el vigilante reconecta el vídeo por la dirección nueva
  (`ServicioReproduccion.olvidarServidor()`), con el texto de la web «La señal se ha cortado: reconectando».

### D.7 Inmersivo y ⛶

`CapaInmersiva` (fuera de la pila): vídeo `ignoresSafeArea()`, controles de la variante «tableta» de a4 §18 con
relleno `max(12, zona segura)`; en el SE, la variante compacta con ⌄ (a4 §18.1). `EstadoVentana`: barra de estado
e indicador de inicio ocultos, `bordesDiferidos = .all`. ⛶ fuerza horizontal; si el aparato sigue en horizontal
al volver con ⛶, se limita a vertical hasta que el sensor informe vertical (a2 §27.8). «Datos técnicos» = panel
de cristal de vídeo sobre la imagen (a4 §15).

### D.8 Mini

`MiniReproductor` en `CapaMini`: cristal denso radio 18, imagen viva 96×54 (hueco `.mini`), textos de a4 §19.2,
📺 (solo si otro dispositivo ve lo mismo en vertical), ⏸/▶ y ■ rellenos. Gestos (`GestosMini`, umbrales de
`MiniPlayer.tsx`): arrastre en los dos ejes (abajo frena al 25 %, opacidad `max(0,35, 1 − |dx|/320)`), arriba ≥ 72
abre el teatro (zoom desde el mini, `ligera`), a un lado ≥ 72 `fuerte` una vez por cruce y al soltar sale volando y
detiene con «Reproducción detenida» + «Deshacer» 6 s. Tocar abre. Entra con `offset(y: 12)` + opacidad y el muelle
estándar.

---

## E. Datos

### E.1 Capas

```
Vistas ─(.consulta(…), acciones)─▶ Modelos de pantalla (@MainActor @Observable)
                                   │
                    ┌──────────────┼───────────────────────────────────────────┐
                    ▼              ▼                                           ▼
             CacheConsultas   Mutaciones/BajasPendientes              SesionFuentes · Reproductor
                    │              │                                           │
                    └──────────────┴────────── APIClient (actor-safe) ◀────────┘
                                                   │ ServerResolver (casa/Tailscale) · Llavero
             TiempoReal (actor) ──SSE──▶ RepartidorEventos ──▶ CacheConsultas / Reproductor / SesionFuentes /
                                                               SenalPartidos / EmparejarOtroModelo / SesionApp
```

### E.2 Cambios del núcleo de red (a8 §3.11, obligatorios)

| Fichero | Cambio | Test |
|---|---|---|
| `Endpoint.swift`, `APIClient.swift` | **plazo total** (carrera en `withThrowingTaskGroup` entre la petición y `Task.sleep(for:)`), `CancellationError` nunca se enseña; `.reloadRevalidatingCacheData` en GET, `.reloadIgnoringLocalCacheData` en el resto; reintento con la otra dirección **solo en GET** | `APIClientTests` (servidor que gotea bytes; `PUT` no se repite) |
| `Rutas.swift` + `PlazosWeb.generated.swift` | plazos de la web (12/14/5/15/20/50/60 s; `resolver` 20/30 s; `ping` 4 s, diferencia consciente) | `EndpointTests` |
| `APIError.swift` | textos del cliente web (a7 §3.3); `retryable`; `describeFailure` | `CatalogoErroresTests` |
| `SSEClient.swift` | esperas 3·2ⁿ tope 60 s; `Last-Event-ID` al reanudar | `SSEClientTests` |
| `Servidores.swift` | `PairingLink.servidores: [URL]` (todas las `u=`), clasificar y guardar la primera de cada tipo; `ServerVia.etiqueta` «Red de casa» | `EmparejamientoTests` |
| `ServicioReproduccion.swift` | `IdentidadVisor`: `v_` + 14 base64url por proceso (a7 §7) | `MaquinaYDirectoTests` |
| `APIClient` · `alPerderAcceso` | ignorado mientras `SesionApp.olvidando` (a9 §3.5.3) | `SesionAppTests` |

### E.3 `CacheConsultas` (port de `api/query.ts`)

```swift
struct ClaveConsulta: Hashable, Sendable { let ruta: RutaID; let parametros: String }
struct Consulta<R: Decodable & Sendable>: Sendable {
    let clave: ClaveConsulta
    let endpoint: @Sendable () -> Endpoint<R>
}
enum Frescura: Sendable { case segunTiempoReal, fija(Duration), nunca }        // ∞ con SSE / 30 s sin él
struct PoliticaConsulta<R: Sendable>: Sendable {
    var frescura: Frescura = .segunTiempoReal
    var reintentos = 2                                  // 1 s y 2 s, solo si retryable
    var siempreAlMontar = false                         // refetchOnMount: 'always'
    var alVolver: AlVolver = .siSinTiempoReal           // refetchOnWindowFocus
    var intervalo: (@Sendable (R?) -> Duration?)? = nil // refetchInterval (p. ej. marcadores 8/45 s)
    static var porDefecto: Self { .init() }
}
@MainActor @Observable final class EntradaConsulta<R: Sendable> {
    private(set) var datos: R?; private(set) var error: APIError?; private(set) var cargando = false
    private(set) var actualizada: ContinuousClock.Instant?
}
@MainActor @Observable final class CacheConsultas {
    init(api: APIClient, tiempoReal: EstadoTiempoRealLector, reloj: ContinuousClock = .init())
    func entrada<R>(_ c: Consulta<R>) -> EntradaConsulta<R>
    func asegurar<R>(_ c: Consulta<R>, _ p: PoliticaConsulta<R>) async           // pide si caducada; una sola en vuelo por clave
    @discardableResult func recargar<R>(_ c: Consulta<R>) async throws -> R      // «Actualizar», «Reintentar»
    func escribir<R>(_ c: Consulta<R>, _ cambio: (R?) -> R?)                      // escrituras directas (a7 §4.3)
    func invalidar(_ ruta: RutaID)                                                // las activas se vuelven a pedir
    func invalidarTodo()                                                          // resync / versión nueva
    func sembrar(con b: BootstrapResponse)                                        // 5 consultas con una petición
}
extension View {
    /// Mantiene viva una consulta mientras la vista está activa (`vistaActiva`): pide al montarse (no al final de la
    /// transición), repite con `intervalo`, se cancela al ocultarse. Equivale a useApiQuery.
    func consulta<R>(_ c: Consulta<R>, politica: PoliticaConsulta<R> = .porDefecto, activa: Bool = true) -> some View
}
enum Consultas {   // catálogo único: bootstrap, agenda, biblioteca, preferencias, ajustes, directorios, motor,
                   // playback, marcadores, precalentado(id), trabajo(id), dispositivos, salud, diagnosticos(causa),
                   // buscar(q) — con las excepciones de a7 §4.2 como políticas con nombre
}
```

Con las pestañas vivas `onDisappear` no se dispara: la visibilidad llega por `@Environment(\.vistaActiva)`.

### E.4 Tiempo real y reparto de eventos

```swift
enum EstadoTiempoReal: Sendable { case inactivo, conectando, abierto, respaldo, demo }
protocol EstadoTiempoRealLector: AnyObject, Sendable { @MainActor var estado: EstadoTiempoReal { get } }
actor TiempoReal {
    init(sse: SSEClient)
    func arrancar(); func parar(); func reanudarYa()           // scenePhase .active
    nonisolated var estados: AsyncStream<EstadoTiempoReal> { get }
    nonisolated var eventos: AsyncStream<SSEEnvelope> { get }
    // guarda el último id (memoria de proceso); respaldo a los 10 s sin abrir
}
@MainActor final class RepartidorEventos {
    init(cache: CacheConsultas, sesion: SesionApp, reproductor: Reproductor, fuentes: SesionFuentes,
         senal: SenalPartidos, emparejarOtro: EmparejarOtroModelo, avisos: Avisos)
    func arrancar()     // consume estados y eventos; respaldo: playback cada 5 s, motor cada 20 s, solo con la app activa
}
```

| Evento | Caché | Además |
|---|---|---|
| `playback.nowPlaying` | escribe `playback.nowPlaying/learningCount` | reproductor: si es sintético (respaldo) y `dev ≠` el propio, late ya |
| `playback.sessions` | escribe `playback.sessions` | «Dónde», mini (otros dispositivos) |
| `playback.handoff`, `stream.*` (dirigidos por `viewerId`) | — | reproductor (traspaso, reenganche, cierre) |
| `engine.status` | escribe `engineStatus` | reproductor: si esperaba al motor, reconecta |
| `scan.progress` | invalida ese `footballScan` | `SenalPartidos` (20 min, `cancelled` borra); `SesionFuentes` pide el trabajo |
| `scan.verdict` | invalida ese `footballScan` | `SesionFuentes` cambia la fuente al momento |
| `state.changed {scopes}` | `library` → biblioteca+bootstrap · `preferences` → preferencias+bootstrap · `directories` → directorios+biblioteca+bootstrap · `bindings` → resolución · `reports` → resolución+salud · `learning` → playback+salud · `stats` → salud · `nowPlaying` → playback · `settings` → ajustes+bootstrap | — |
| `diagnostics.new` | invalida diagnósticos y salud | — |
| `devices.changed` (0.8.1) | invalida dispositivos | con código a la vista y `paired` de un id nuevo → «emparejado»; `revoked` del propio sin `olvidando` → `accesoPerdido(.revocadoDesdeOtro)` |
| `resync` | invalida **todo** | `VigilanteVersion` pregunta `ping` |
| al abrir tras un corte | invalida playback y motor | — |

### E.5 Sondeos (solo donde la web sondea)

| Qué | Condición | Intervalo | Dueño |
|---|---|---|---|
| Marcadores (agenda/partido) | el día visto tiene algún partido en `[start − 15 min, start + 3,5 h]` (`scoresWanted`) | 8 s si alguno `in`, 45 s si no | `.consulta(Consultas.marcadores, politica: .marcadores(dia:))` en Agenda y Teatro |
| Marcadores (Canales) | hoy hay algo con minutos ∈ [−210, 15] | 8/45 s | CanalesView |
| Precalentado por tarjeta | con canales, ventana −45/+120 min, no terminado | 30 s **solo sin SSE** | cada `TarjetaPartido`/héroe montada y visible |
| Comprobador | trabajo vivo | 1,5 s solo sin SSE | `SesionFuentes` |
| Respaldo del SSE | 10 s sin abrir | playback 5 s, motor 20 s | `RepartidorEventos` |
| Dispositivos | código a la vista, sin SSE, Ajustes visible | 5 s | `EmparejarOtroModelo` |
| Relojes | reloj compartido 20 s (agenda), 30 s (Canales), 60 s por sección en Ajustes, 1 s cuenta atrás | — | `RelojCompartido`, `.task(id: vistaActiva)` |

Se quitan los bucles globales de hoy (`vigilarMarcadores` 60 s, `vigilarSesiones` 20 s, `precalentar` de 6
partidos, a8 §3.11.3).

### E.6 Arranque, identidad, versión y capacidades

```swift
@MainActor @Observable final class SesionApp {
    private(set) var fase: FaseRaiz
    private(set) var conexion: EstadoConexion            // alimenta el motor y «Servidor»
    private(set) var dispositivo: Device?                // bootstrap.device → «Este iPhone»
    private(set) var versionServidor: String?
    let capacidades: Capacidades
    private(set) var olvidando = false
    func arrancar() async                                // ServerResolver.actual(); async let bootstrap ∥ football; sembrar; TiempoReal
    func volvioAPrimerPlano(); func pasoASegundoPlano()
    func abrir(enlace: URL)                              // aceneo://pair… (emparejado → hoja «¿Emparejar con otro servidor?»)
    func accesoPerdido(_ m: MotivoEmparejar)
    func olvidarEsteIPhone() async throws                // DELETE propio (a9 §3.5.2)
    func olvidarEsteServidor()                           // local
}
@MainActor @Observable final class Capacidades {        // «memo» de a7 §2.4.1 / a9 §9.1
    enum Estado: Sendable { case desconocida, abierta, cerrada }
    private(set) var administracion: Estado
    func anotar(_ error: APIError, ruta: RutaID)         // 403 origin_forbidden en health/settingsUpdate/pairingCreate/devicesList/deviceRevoke
    func anotarExito(ruta: RutaID); func olvidar()
}
enum Identidad { static func deviceId(token: String) -> String?; static let visor: String }   // v_ + 14 por proceso
```

`VigilanteVersion` (a7 §5.2): pregunta `ping` tras `resync`, tras reabrir el SSE y al volver tras ≥ 30 min en
segundo plano; versión distinta → `capacidades.olvidar()`, `cache.invalidarTodo()` y toast «Tu Umbrel tiene ahora
Ace Player Neo X.» (4 s, no en inmersivo).

### E.7 Caché en disco e imágenes

`DiskCache` (agenda, biblioteca, arranque, preferencias) para pintar al instante antes del servidor (a2 §23.1);
`CacheImagenes` para escudos y logos (URL con `/native`, bearer, clave SHA-256 independiente de la dirección) con
`byPreparingForDisplay()`. Nunca `AsyncImage`.

### E.8 Reglas puras portadas y sus tests espejo

| `AceReglas/…` | Web | Vectores (`generar-vectores.mjs`) + tests portados |
|---|---|---|
| `Agenda/*` | `features/agenda/{domain,cards,score-reveal}.ts`, `data.ts` (`scoresWanted`, `scoresInterval`, `useMatchSignal`) | `agenda.json`; `domain.test.ts`, `cards.test.ts`, `score-reveal.test.ts` |
| `Dominio/{ParaTi,Canales,Hash}` | `shared/domain/{for-you,channels,hash}.ts` | `vectores-dominio.json` (existe) + matriz T-088 |
| `Color/*` | `lib/{color,teams}.ts` | `color.json`; `color.test.ts`, `teams.test.ts` |
| `Fuentes/*` | `features/sources/model.ts` | `fuentes.json`; `model.test.ts` (494 líneas) |
| `Reproductor/*` | `player/{status,constants}.ts` | `reproductor.json`, `textos-web.json`; `status.test.ts` |
| `Biblioteca/*` | `features/library/{model,on-air}.ts`, `player/zapping.ts` | `biblioteca.json`; sus tests |
| `Busqueda`, `Listas`, `Preferencias`, `Donde`, `Salud`, `Dispositivos` | `features/{search,directories,preferences,where-playing,health,devices}/model.ts` | un JSON por área; sus `*.test.ts` |
| `Avisos/*` | `notices/{toasts,statusLine}.ts` | `avisos.json`; `notices.test.tsx`, `wording.test.ts` |
| `Gestos/*` | `lib/gestures.ts`, umbrales de `MiniPlayer.tsx`, `Sheet.tsx`, a2 §2.4 | `gestos.json`; `gestures.test.ts` |
| `Formato/*` | `Intl` es-ES (tablas propias: `ene … sept … dic`, `lun … dom`) | `formato.json` (fechas de muestra formateadas por Node) |

Los vectores se generan **ejecutando el TypeScript** (Node ≥ 23.6 quita los tipos; lo que importe `@ace/shared`
o JSX se empaqueta antes con el `esbuild` del monorepo). Cada área tiene además los casos de sus `*.test.ts`
portados a `@Test(arguments:)` de Swift Testing. Todo corre en Linux (§G.4) y, con un test de humo, en iOS.

---

## F. Servidor simulado con la demo de la web, UITests y capturas

### F.1 Objetivo

Con `-AceNeoDemo -AceNeoReloj 2026-09-24T19:00:00+02:00`, la app pinta **los mismos datos** que la web con
`?demo=1` y el reloj fijado a esa hora (a7 §5.1, §13): misma agenda (demo-1…13, ancla de 5 min), marcadores que
avanzan con el reloj, precalentados, planes del comprobador (Elcano 2,7 s, Cierzo floja, demo-12 en espera),
buscador, salud, registro, dispositivos, biblioteca y «Dónde».

### F.2 Cómo se generan los datos: `scripts/generar-demo.mjs`

1. Empaqueta con el `esbuild` del monorepo una entrada que importa `features/agenda/demo-data.ts`,
   `features/sources/demo-data.ts`, `features/search/demo.ts`, `features/health/demo.ts`,
   `features/devices/demo.ts`, `api/demo/index.ts` y los `fixtures/v1/*.json` (con *shims* de `localStorage` y del
   registro de manejadores).
2. Instala un reloj falso (`Date` sustituido) en `T0 = 2026-09-24T19:00:00+02:00`.
3. Escribe **semillas** (lo que no depende del tiempo): biblioteca, preferencias, ajustes, dispositivos, motor,
   `playback`, plantilla de salud, registro (en «minutos antes»), catálogo del buscador, tabla `CLUBS`,
   competiciones, planes del comprobador por partido, tonos de canal → `SemillasDemo.generated.swift`
   (`#if DEBUG`, JSON en base64).
4. Escribe **vectores temporales**: la respuesta de `football`, `scores`, `preheat/:id`, `football/resolve` y
   `scans/:id` en T0 + {0 s, 1,35 s, 2,7 s, 5,4 s, 10 s, 6 min, 45 min, 3 h} → `Vectores/demo-*.json`.
5. `--check` falla si la web cambia sus datos de demo.

### F.3 El simulado en Swift (`Sources/Simulado`, todo `#if DEBUG`)

```swift
protocol Reloj: Sendable { var ahora: Date { get } }                 // real, o fijo que arranca en -AceNeoReloj y avanza
enum ServidorDemo {
    static func entorno(opciones: OpcionesSimulado) -> Entorno        // URLSession efímera con ProtocoloDemo
}
struct OpcionesSimulado: Sendable {
    var emparejada: Bool; var demo: Bool; var reloj: any Reloj
    var historialCapturas: Bool; var servidor080: Bool; var sse: Bool
}
final class ProtocoloDemo: URLProtocol { … }                          // enruta /native/api/v1/* a EnrutadorDemo
struct EnrutadorDemo: Sendable { func responder(_ peticion: URLRequest, estado: EstadoDemo) async -> RespuestaDemo }
final class EstadoDemo: @unchecked Sendable { /* Mutex<…>: biblioteca, preferencias, ajustes, dispositivos, trabajos */ }
enum AgendaDemo, MarcadoresDemo, FuentesDemo (demoHash FNV-1a + xorshift32), BuscadorDemo (fakeHash), SaludDemo
```

- Lo dinámico (ancla, minuto de juego y goles, pasos del comprobador cada 1 350 ms, `retryAt`, hashes) es un port
  de la demo, probado contra los vectores temporales con el reloj inyectado (`SimuladoTests`).
- Tiempos: 120 ms en las respuestas «de ejemplo», 0 en las que tienen manejador, 260 ms en la búsqueda.
- Con `-AceNeoDemo`: `TiempoReal` en estado `demo` (sin SSE; entran las reglas «sin SSE» de la web), textos de
  demo (a7 §5.1), imagen de demo en el vídeo (`ImagenDemo`: el campo dibujado de a7 §13.13, el mismo SVG como
  `Canvas`), `MotorSimulado` a 1,8 s. Sin `-AceNeoDemo` (UITests de flujo): mismos datos en modo «en vivo» con un
  SSE simulado (`SSEDemo`).
- `-AceNeoServidor080`: 403 `origin_forbidden` en las 5 rutas de a9.
- El segundo visor de «Dónde» usa `deviceId` distinto del iPhone emparejado **solo con `-AceNeoDemo`**, para que la
  captura cuadre con la web (a7 §13.7); en los flujos es el propio («Este dispositivo»).

### F.4 Argumentos de lanzamiento (Debug; en Release se ignoran)

`-AceNeoServidorSimulado`, `-AceNeoEmparejado`, `-AceNeoEmpezarDeCero` (existen) · `-AceNeoDemo` ·
`-AceNeoReloj <ISO>` · `-AceNeoHistorialCapturas` · `-AceNeoServidor080` · `-AceNeoVista <vista>` (mismo
formato que `?vista=`) · `-AceNeoEscena <nombre>` · `-aceneo-tema claro|oscuro` · `-aceneo-transparencia reducida`
· `-AceNeoMovimientoReducido` · `-AceNeoSistema`. Los lee `ModoEjecucion` (existe).

### F.5 Escenas de captura (`EscenasCaptura.swift`)

Preparan en la app, sin pasos de interfaz, el estado de cada vista de `capturas/_revision/web-palco/final/`:
`agenda`, `partido` (demo-1 hasta «Fuente 1 verificada: arrancando»), `reproductor` (canal `a1b2…5678`),
`mini-reproductor` (suena DAZN 1, en la agenda), `biblioteca-{favoritos,recientes,listas,sonando,vacia}` (vacía =
filtro «zzzz»), `buscar` (`q=deportes`), `buscar-enlace`, `pegar`, `preferencias`, `ajustes`,
`ajustes-{apariencia,reproduccion,donde,motor}`, `dispositivos`, `salud`, `ayuda`, `sistema`, y los estados de a8
§8.4 (`biblioteca-toast-deshacer`, `mini-toast-deshacer`, `agenda-menu-tarjeta`, `partido-hoja-reportar`,
`partido-hoja-encontrar`, `agenda-vacio-dia`, `partido-ninguna-senal`…), más `emparejar` (solo app).

### F.6 UITests de flujo

- Identificadores en `Armazon/IdentificadoresUI.swift` (`enum IDUI { static let barraPestanas = "barra-pestanas" … }`),
  compilado en la app **y** en los UITests: las mismas cadenas que los `data-testid` de la web donde existan; los de
  a8 §6.3 y a2 §22.9 para emparejar.
- Ayudas que se quedan: `elementoUI`, `conTextoUI`, `arrastrar(…press(forDuration:thenDragTo:))`, `sePinta`
  (píxel distinto del fondo) y `ServidorDePruebas`. `tocarPestana` se reescribe para la barra propia.
- Ficheros: `FlujoEmparejarUITests` (código `482913`, enlace `aceneo://`, error en español, hoja «otro servidor»),
  `FlujoAgendaUITests` (tira de días `sePinta`, cambiar de día deslizando, «Para ti/Todos», destapar, tirar para
  actualizar, menú contextual), `FlujoTeatroUITests` (zoom desde la tarjeta, arranque automático, elegir fuente,
  deslizar el vídeo a un lado, doble toque = horizontal, minimizar arrastrando, volver desde el borde, «Más
  opciones»), `FlujoMiniUITests` (arriba abre, a un lado detiene con «Deshacer»), `FlujoCanalesUITests` (quitar
  favorito y deshacer, categorías, buscar en el motor, pegar hash), `FlujoAjustesUITests` («Dónde», tema,
  Dispositivos 0.8.1 y 0.8.0, olvidar este iPhone), `ServidorRealUITests` (E2E de hoy, adaptado).
- `continueAfterFailure = false`; `-retry-tests-on-failure` solo en UITests.

### F.7 Capturas

`CapturasPalcoUITests` recorre una matriz `(escena × tema × orientación)`; para cada una lanza con
`-AceNeoDemo -AceNeoReloj 2026-09-24T19:00:00+02:00 -AceNeoEscena <e> -aceneo-tema <t>`, gira con
`XCUIDevice.shared.orientation`, espera a `sePinta` del elemento clave de la escena y adjunta
`XCUIScreen.main.screenshot()` con el nombre **`<vista>-<ancho>x<alto>-<tema>.png`**, donde ancho×alto se lee de
`app.windows.firstMatch.frame` (nunca se inventa: en un 17 Pro saldrá `402x874`). Variantes
`-claro-transparencia-reducida` y `-oscuro-movimiento-reducido` para `agenda` y `partido`, como la web.

- Simulador: la CI elige **iPhone 16e** (390×844, iOS 26.5) para las capturas, con el «Pro» de respaldo.
- En cada ejecución normal: 6 capturas clave (agenda, partido, mini, biblioteca-favoritos, ajustes, emparejar) en
  los dos temas; la matriz entera (≈ 22 vistas × 2 temas × 2 orientaciones + estados) solo con la entrada
  `capturas: completas` del workflow (≈ 15 min).

### F.8 Comparación con la web

`scripts/comparar-capturas.py` (Pillow; en la CI) empareja por nombre `design-explorations/capturas/_revision/
web-palco/final/<vista>/<vista>-390x844-<tema>.png` con la del simulador reducida a 1× (mismo filtro siempre),
calcula diferencia por zonas (cabecera, contenido, barra) y sube un informe HTML con las dos imágenes, la
diferencia y el porcentaje. Para que la comparación tenga sentido, el lado web necesita (cambios en
`apps/web/scripts/revision-visual.mjs`, fase de código, sin tocar la app web): `--reloj <ISO>` (`context.clock.
install` + `page.clock.setSystemTime` por vista, a7 §5.1), `--escala 3`, los tamaños 375×667, 375×812, 667×375 y
844×390 claro (a8 §8.4), y **zonas seguras simuladas** inyectando `:root { --safe-top: 47px; --safe-bottom: 34px }`
(los tokens `--safe-*` de `tokens.css:102-105` lo permiten) para calcar el 16e.

---

## G. Plan de implementación paralelizable

### G.1 Oleadas, agentes y carpeta exclusiva

| Oleada | Agente | Carpeta exclusiva (solo él escribe) | Depende de |
|---|---|---|---|
| **0 · Cimientos** (1 agente, secuencial) | Integrador | `project.yml`, `Config/`, `App/`, `Armazon/{Navegador,Ruta,ShellLayout,IdentificadoresUI,CentroHojas}.swift`, `Palco/Tokens/EntornoPalco.swift`, todos los **contratos** (§G.2), `scripts/{generar-tokens,generar-iconos,generar-fuentes,generar-plazos,generar-rutas,comprobar-prohibidos}`, `.github/workflows/ios.yml`, `Resources/` | — |
| **1** (en paralelo) | N · Núcleo de datos | `Nucleo/**` (salvo lo del integrador) + sus tests | contratos |
| | R · Reglas | `Paquetes/AceReglas/**` + `scripts/{generar-vectores,generar-textos}.mjs` | — (Swift puro) |
| | P · Palco | `Palco/**` (componentes, cristal, movimiento, háptica, galería) | tokens e iconos generados |
| | V · Reproducción | `Reproduccion/**` + tests del reproductor | contratos, `AceReglas/Reproductor` (stubs) |
| | S · Simulado | `Sources/Simulado/**` + `scripts/generar-demo.mjs` + `SimuladoTests` | contratos |
| | W · Servidor 0.8.1 | monorepo: lo de a9 §2, §5, §7, §8 (otra carpeta: `apps/server`, `packages/shared`) | — |
| **2** (en paralelo) | A · Armazón | `Armazon/**` (resto) | P, N |
| | G · Agenda + gustos | `Pantallas/Agenda/**` | P, N, R |
| | T · Teatro + mini + inmersivo | `Pantallas/{Teatro,Mini}/**`, `Armazon/CapaInmersiva.swift` (cedido) | P, V, N |
| | C · Canales + Buscar + Pegar | `Pantallas/{Canales,Buscar,Pegar}/**` | P, N, R |
| | J · Ajustes + Emparejar | `Pantallas/{Ajustes,Emparejar}/**` | P, N, R |
| | U · UITests y capturas | `Tests/AceNeoUITests/**`, `Simulado/EscenasCaptura.swift` (cedido), `scripts/comparar-capturas.py` | S, A |
| **3** | Integrador (+1) | pulido, huecos, comparación de capturas, iPhone real (Isma) | todo |

Máximo 7 a la vez (oleada 1: N, R, P, V, S, W; oleada 2: A, G, T, C, J, U).

### G.2 Contratos que escribe la oleada 0 (compilan con cuerpos vacíos)

- `Armazon/Ruta.swift`, `Navegador.swift`, `ShellLayout.swift` (completo: es puro), `CentroHojas.swift` (§C.5, §C.4, §C.10).
- `Palco/Tokens/EntornoPalco.swift`: todos los `@Entry` (`shell`, `vistaActiva`, `cristalReducido`,
  `movimientoReducido`, `modoDemo`, `espacioZoom`, `radioInterior`).
- Firmas (cuerpo mínimo que compila: `EmptyView()`, `return self`, `[]`) de: `EstiloTexto` + `estilo(_:)`, `Mona`,
  `Icono` (generado completo), `IconoPalco`, `IconoImagen`, `cristal(_:en:)`, `sombra(_:en:)`, `Animation.palco`,
  `Haptica`, `haptica(_:al:si:)`, `Boton`, `BotonIcono`, `Capsula`, `Num`, `TarjetaVersus`, `Segmentado`,
  `CabeceraVista`, `ContenidoHoja`, `ElementoMenu`/`MenuPalco`/`menuContextual`, `Avisos`, `EstadoBaseLinea`.
- Datos: `RutaID` (generado), `ClaveConsulta`, `Consulta`, `PoliticaConsulta`, `EntradaConsulta`, `CacheConsultas`
  (API), `Consultas`, `.consulta(...)`, `EstadoTiempoReal`, `EstadoTiempoRealLector`, `TiempoReal`, `SesionApp`,
  `Capacidades`, `Reloj`.
- Reproducción: `PresentacionReproductor`, `SesionFuentes` (firmas de §D.4), `PrioridadHueco` con `.inmersivo`.
- `AceReglas`: los tipos de salida que usan las vistas (`EstadoSenal`, `DatosVersus`, `EstadoPartido`,
  `EtiquetaDia`, `EntradaFuente`…) con las funciones devolviendo valores neutros.
- `IdentificadoresUI` con todos los identificadores.

Un contrato solo lo cambia el integrador (petición en el hilo del agente); los demás agentes **no** editan fuera
de su carpeta. XcodeGen incluye por carpeta, así que ningún agente toca `project.yml`.

### G.3 Ramas y ritmo

- Rama base `rediseno/nativa`; cada agente en `rediseno/nativa-<letra>` (worktree propio), `git rebase` sobre la
  base antes de pedir integración; integra el integrador en orden de dependencias (N, R, P, V, S → A → G, T, C, J
  → U).
- Cada agente lanza su propia compilación en su rama:
  `gh workflow run ios.yml -R Ismaeloul/umbrel-app-store --ref rediseno/nativa-<x> -f solo_compilar=true`
  (el grupo de concurrencia es por rama: van en paralelo) y lee `gh run view <id> --log-failed`.
- Commits con la identidad de la memoria (`git -c user.name="Isma" -c user.email=…`) y `Co-Authored-By`.

### G.4 Cómo no romper la compilación sin Xcode

**CI** (cambios en `ios.yml` de la oleada 0):

1. `solo_compilar` compila además **Release para dispositivo**
   (`xcodebuild build -configuration Release -destination generic/platform=iOS CODE_SIGNING_ALLOWED=NO`), en
   paralelo con el Debug de simulador: el `wholemodule` sin `#if DEBUG` falla donde el Debug no.
2. Paso nuevo tras compilar: `grep` del log por `took [0-9]+ms to type-check` / `to type-check` → **falla el
   trabajo** con la lista de expresiones (los avisos de `-warn-long-*` pasan a ser error de CI, a8 §9.2).
3. Trabajo nuevo **`reglas-linux`** (`ubuntu-latest`, contenedor `swift:6.2`): `swift test --package-path
   ace-player-neo/apps/ios/Paquetes/AceReglas` en 2–3 min, en cada push y con `workflow_dispatch`.
4. Pasos de comprobación antes de compilar (segundos): todos los `generar-*.mjs --check` y
   `comprobar-prohibidos.mjs`.
5. Entradas nuevas: `ipa_sin_tests` (compilar + archive, ~8 min) y `capturas: [ninguna|clave|completas]`.
6. Tests en dos pasos: unitarios **sin** reintento, UITests con `-retry-tests-on-failure -test-iterations 2`.
7. Simulador: preferir «iPhone 16e»; si no, el Pro más alto (lo de hoy).

**`comprobar-prohibidos.mjs`** (falla la CI; lista con el motivo de cada regla):

| Patrón | Por qué |
|---|---|
| `#"` que contenga `"#` dentro (cadena cruda que se cierra antes) | a8 §9.1 (0.8.0 rota en 1 min 40 s) |
| `GeometryReader` en el mismo cuerpo que `.ignoresSafeArea(` | a8 §9.3 (zonas seguras a cero) |
| `tabViewBottomAccessory`, `TabView`, `.tabItem` | a8 §9.4 y decisión 4 |
| `.monospacedDigit()`, `Font.custom(`, `.font(.body` y demás estilos de sistema, `.fontWeight(`, `.fontWidth(`, `@ScaledMetric` | a1 §0.4, §3.7; a2 §26 |
| `#available`, `@available(iOS 1…2[0-5]` | mínimo iOS 26: sin ramas |
| `AsyncImage(` | caché propia |
| `DispatchQueue.main.async`, `ObservableObject`, `@Published` | Swift 6 / Observation |
| `.onChange(of:perform:)` (una sola clausura) | forma antigua |
| `import UIKit\|SwiftUI\|CoreGraphics` dentro de `Paquetes/AceReglas` | el trabajo Linux |
| `nonisolated(unsafe)` sobre constantes `Sendable` | a8 §3.6 |

**Reglas de escritura** (en el README de la carpeta y en el encargo de cada agente):

- `body` ≤ ~30 líneas; ≤ ~10 modificadores seguidos; subvistas con nombre; `@ViewBuilder private var`.
- Tipos explícitos en toda clausura de `sensoryFeedback`, `onChange`, `onGeometryChange`, `Binding(get:set:)`,
  `ForEach` con índices; nada de miembros implícitos (`.leading`) dentro de ternarios largos.
- Colores y medidas calculados en `let` antes del cuerpo; nada de interpolar `Double` en `Text` sin formatear.
- `some Shape` condicionales con `AnyShape`; `ForEach` con `id:` explícito.
- Aislamiento: modelos `@MainActor @Observable final class`; clausuras de acciones `@MainActor`; nada de capturar
  `self` de una `View` en `Task`s largas (pasar métodos del modelo); delegados de AVFoundation con conformidad
  aislada `extension X: @MainActor Protocolo` (Swift 6.2).
- APIs **seguras** (iOS 17–26, sin duda de nombre): `glassEffect(_:in:)`, `GlassEffectContainer(spacing:)`,
  `Glass.regular/.clear`, `.tint(_:)`, `.interactive()`, `matchedTransitionSource(id:in:)`,
  `navigationTransition(.zoom(sourceID:in:))`, `ScrollPosition`, `scrollPosition(_:)`, `scrollTo(edge:)`,
  `onScrollGeometryChange(for:of:action:)`, `onGeometryChange(for:of:action:)`, `scrollTargetBehavior(.viewAligned)`,
  `contentMargins(_:_:for:)`, `scrollClipDisabled()`, `refreshable`, `sensoryFeedback(_:trigger:condition:)`,
  `contentTransition(.numericText(value:))`, `rotation3DEffect`, `keyframeAnimator`, `phaseAnimator`,
  `TimelineView(.animation)`, `presentationDetents`, `presentationDragIndicator`, `presentationContentInteraction`,
  `contextMenu(menuItems:preview:)`, `Menu`, `PasteButton`, `ImageRenderer`, `UIGestureRecognizerRepresentable`,
  `@Entry`, `Observations`, `Task.immediate`, `Mutex`, `AccessibilityNotification.Announcement`,
  `accessibilityShowsLargeContentViewer()`, `CIFilter.qrCodeGenerator()`, `AVCaptureDevice.RotationCoordinator`,
  `AVRouteDetector`, `requestGeometryUpdate(.iOS(interfaceOrientations:))`.
  **A verificar en el spike antes de usar**: el modificador de efecto de borde del scroll, `lineHeight` de iOS 26,
  observación de `AVPlayer` de iOS 26 (no hace falta: el motor sondea), `@Animatable`.
- Ciclo por agente: lote de ficheros → comprobaciones locales (`node scripts/comprobar-prohibidos.mjs`, generadores
  `--check`, y en R `swift test` en Linux) → push → `solo_compilar` (~6–9 min) → corregir. Nunca empujar un
  fichero que no se ha releído entero.

### G.5 Spike de la oleada 0 (pantalla `Laboratorio`, solo Debug, con capturas en la CI)

Antes de la oleada 2 se confirma en el simulador (capturas + UITests) lo que no se puede saber leyendo:

1. Mona Sans con métricas 885/−115: capturas de «Agenda» 30/1,1, un título 22/1,25 en dos líneas y un párrafo
   15/1,45 superpuestas a la web (tolerancia 1 pt); acentos y «g/ç» sin recortar; `TextField` con la fuente
   original.
2. `glassEffect` con tintes al 86–90 % (barra, toast, mini) y 62 % (cápsulas sobre vídeo) contra las capturas;
   transparencia reducida.
3. `navigationTransition(.zoom)` en una pila con la barra del sistema **oculta**: ¿funcionan el borde y el
   arrastre hacia abajo? ¿el origen puede estar fuera del `NavigationStack` (mini en la capa raíz)? Plan B: borde
   con `BordeAtras` (a2 §27.4) y arrastre propio del vídeo con `DragGesture` (56 pt / 450 pt/s).
4. `.contextMenu` con vista previa sobre una celda con la `AVPlayerLayer` y sobre un carril horizontal.
5. `presentationDetents([.height(h)])` con altura medida; teclado en la hoja «Pegar».
6. `SubeConLaBarra` (scrollsToTop) con dos `ScrollView` vivos.
7. Estilo de la barra de estado desde `HostingPalco` al desplazar el héroe.
8. Tiempos de compilación del laboratorio (control del type-checker).

### G.6 «Hecho» por pantalla

Compila Debug y Release; sin avisos de type-check; UITests de su flujo en verde; captura `390x844` claro/oscuro
comparada con la web (diferencia explicada en el informe); VoiceOver: todos los nombres de la web, acciones de
menú como `accessibilityActions`; movimiento reducido y transparencia reducida capturados donde la web los tiene;
horizontal 844×390 capturado.

---

## H. Riesgos principales y mitigación

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | **No compilar** (solo CI, 6–9 min por vuelta; type-checker) | semanas perdidas | contratos compilables desde la oleada 0; ramas por agente con `solo_compilar`; Release en el mismo modo; aviso de type-check = error; `reglas-linux` en 2 min; prohibiciones; cuerpos cortos |
| 2 | **Alto de línea** distinto de CSS | todo desplazado 2–5 pt | TTF con métricas normalizadas + `altoDeLinea` (§B.2), validado en el spike; plan B `UILabel` |
| 3 | **Fuente variable** mal pedida (peso 200, sin anchura) | Palco irreconocible | fábrica única `Mona` + `FuentesTests`; prohibido `Font.custom` |
| 4 | **Zoom nativo** incompatible con barra oculta, con el origen en la capa raíz o con los gestos propios | sin volver desde el borde / sin minimizar arrastrando | spike §G.5-3 con plan B ya diseñado; el inmersivo fuera de la pila evita gestos no deseados |
| 5 | **Liquid Glass** se aparta del 86–90 % de la web | barra y toasts más transparentes | tinte calibrado en una constante; comparación de capturas; opaco con transparencia reducida |
| 6 | **Hojas nativas** con márgenes y cristal del sistema | diferencia visual asumida (decisión 5) | contenido idéntico; alturas medidas; en horizontal, el sistema decide |
| 7 | **Menú contextual** sobre el vídeo muestra negro o se levanta raro | fea vista previa | vista previa propia (tesela + título) |
| 8 | **Una sola `AVPlayerLayer`** entre pila, capa raíz, mini y PiP | vídeo doble o negro | prioridades de hoy + `.inmersivo`; `SuperficieUnicaTests` y `PiPTests` se conservan; UITest de minimizar/volver |
| 9 | **Semántica de TanStack** mal portada | peticiones de más, parpadeos, datos viejos | `CacheConsultas` con tests de cada política de a7 §4.2; `vistaActiva` en vez de `onAppear` |
| 10 | **SSE en segundo plano** y reanudación | señal y «Dónde» viejos | `Last-Event-ID` guardado, `resync` invalida todo, respaldo a los 10 s, reconexión inmediata al volver |
| 11 | **Normalización Unicode, fechas y números** distintos de `Intl` | «Ver canal», «Emitiendo ahora», «23 sept» distintos | port literal, tablas propias, vectores ejecutando el TS |
| 12 | **Datos de demo que dependen del reloj** | capturas nunca iguales | `-AceNeoReloj` y `--reloj` en la web con la misma hora; vectores temporales |
| 13 | **Tamaño y zonas seguras del simulador** ≠ capturas web | comparación inútil | iPhone 16e + `--safe-*` inyectadas en la web + `--escala 3`; nombres con el tamaño real |
| 14 | **Servidor 0.8.0** en el Umbrel de Isma | Salud, Dispositivos e interruptor no calcan | `Capacidades` por 403; `-AceNeoServidor080` en pruebas; W publica la 0.8.1 a la vez |
| 15 | **Muchos agentes en paralelo** pisándose | conflictos y contratos rotos | carpetas exclusivas, contratos del integrador, XcodeGen por carpeta, integración en orden |
| 16 | **Gestos** nuevos (vídeo a los lados, doble toque) contra scroll, borde y menú | gestos que no arrancan o roban | reconocedores UIKit con `require(toFail:)`, umbrales puros probados, UITests de arrastre |
| 17 | **Sin Xcode para depurar** fallos solo del aparato (PiP, AirPlay, bloqueo, barra de estado real) | sorpresas en el iPhone | `ipa_sin_tests` (~8 min) y la lista de `docs/pruebas-iphone.md` ampliada con los gestos y el cristal |
| 18 | **iOS 27** en el iPhone de Isma cambia el cristal o las hojas | aspecto distinto al del simulador 26.5 | todo lo que no es hoja/menú es propio; el cristal centralizado en un modificador |
| 19 | **Rendimiento** (muchas ondas, cristal sobre listas largas, carruseles) | tirones | `TimelineView` solo con la vista activa, `LazyVStack`, `Path` estáticos, `byPreparingForDisplay`, `drawingGroup` en ilustraciones, ondas paradas fuera de pantalla |

---

## Anexo · Preguntas que quedan para Isma (no bloquean la oleada 0)

1. Fondo de las hojas: ¿el cristal del sistema (propuesto, «nativas») o `glassSolid` opaco de la web con
   `.presentationBackground`?
2. Barra de estado en claro al dejar atrás el héroe: ¿oscura (propuesto) o blanca como la web instalada?
3. AirPlay solo cuando hay rutas (propuesto) o siempre visible en la cápsula.
4. El toast «Tu Umbrel tiene ahora Ace Player Neo X.»: ¿se queda o silencioso?
