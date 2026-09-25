# B3 · Arquitectura de la app nativa «Palco» 0.8.1 con riesgo mínimo de compilación y de regresiones

> Fase 3, propuesta de arquitectura (solo diseño: no se ha tocado ningún fichero del repositorio).
> Enfoque pedido: **riesgo mínimo** de no compilar y de romper lo que ya funciona, sin Xcode local.
> Leído entero: a1…a9 de esta carpeta; `apps/ios/project.yml`, `Config/*`, `Sources/Core/**`,
> `Sources/Player/**`, `Sources/Features/Pairing/**`, `Sources/Debug/**`, `Sources/App/Entorno.swift`,
> las superficies públicas de `AppModel`, `Reproductor`, `SuperficieVideo`, `CentroPartidoModelo`,
> `Tests/**` (ayudas y dependencias cruzadas) y `.github/workflows/ios.yml` (con `solo_compilar` ya
> commiteado en `206a50d`). También las carpetas de la web que hay que portar (`apps/web/src/**`) y
> la herramienta disponible en el PC (Node 24, Docker Desktop, `tsx` 4.23 en el monorepo; **no hay
> Swift ni Xcode**).
>
> Rutas relativas a `ace-player-neo/apps/ios/` salvo que se diga otra cosa.
> Las **decisiones de Isma** (1-10 del encargo) mandan sobre a1-a9; donde este documento contradice
> una especificación por esa razón, lo dice (§0.3).

---

## 0. Resumen y principios

### 0.1 Las ocho reglas de riesgo que ordenan todo lo demás

| # | Regla | Por qué reduce el riesgo |
|---|---|---|
| R1 | **Un solo módulo de app** (el target `AceNeo` de hoy), Swift 6 en modo de lenguaje 6 con concurrencia estricta `complete`, **sin** «default actor isolation = MainActor» y **sin** «Approachable Concurrency». | Es exactamente la configuración que hoy compila y pasa ~190 tests. Activar el aislamiento por defecto cambiaría la semántica del núcleo probado (los modelos `Codable` y los `actor` chocarían). Partir en frameworks obligaría a rehacer el control de acceso (`public`/`@testable`) sin poder comprobarlo en local. |
| R2 | **Núcleo puro compilable en Linux**: todo lo que no es interfaz ni AVFoundation (modelos, reglas, dominio, parser SSE, endpoints, catálogo de errores, algoritmos del servidor demo) solo importa `Foundation` y se compila y prueba con un **paquete espejo SwiftPM** (`apps/ios/Package.swift`) en Docker (`swift:6.2`) en el PC de Isma y en un job de Ubuntu en la CI (~3 min). | Es la única forma de *compilar Swift de verdad* antes de gastar 20 min de macOS. Cubre ~60 % del código no visual y el 100 % de las reglas con tests espejo. |
| R3 | **Canarios de API** en la ola 0: un fichero por API de iOS 26 (o de firma dudosa) compilado en la CI antes de escribir pantallas. Solo se usa lo que el canario confirma. | Evita descubrir a mitad del trabajo que `glassEffect`, `scrollEdgeEffectHidden` o la firma de `onGeometryChange` no son como se esperaba. |
| R4 | **Todo lo copiable se genera** desde la web con `--check` en la CI: colores (`tokens.css`), iconos (`ui/icons.ts`), plazos (`api/client.ts`), catálogo de errores (ya existe), **vectores** de las reglas puras y **datos/golden de la demo**. | Cero copias a mano que puedan divergir; si la web cambia, la CI lo dice. |
| R5 | **Revisor estático de Swift** en Node (`scripts/revisar-swift.mjs`) con los patrones que la CI ya rechazó y los que la experiencia desaconseja (§G.5); se ejecuta en Windows antes de cada push y como primer paso de la CI. | Detecta en 1 s lo que la CI tardaría 2-6 min en decir. |
| R6 | **Contratos primero** (ola 0): tipos, protocolos y **vistas stub que compilan** para cada pieza compartida; las firmas se congelan y los agentes solo rellenan cuerpos en su carpeta exclusiva. | 5-8 agentes escriben a la vez sin pisarse ni romper las firmas que usan los demás. |
| R7 | **Lo nativo donde Isma lo pidió, lo propio donde lo pidió**: hojas `.sheet`, `Menu` y `.contextMenu` del sistema; barra de pestañas propia con `glassEffect`; capa del partido propia (sin `NavigationStack` ni `TabView`). | Menos código propio en hojas/menús (foco, teclado, VoiceOver gratis) y ninguna pieza del sistema que ya dio guerra (`TabView` + `tabViewBottomAccessory`). |
| R8 | **Ciclos cortos**: un `workflow_dispatch` con `modo = compilar` (Debug simulador + Release dispositivo, ~6-8 min), `unitarios`, `completo`, `ipa-sin-tests`; commits pequeños; nunca dos olas sin una compilación verde entre medias. | La CI es el único compilador de interfaz: cuanto más corto el ciclo, menos errores apilados. |

### 0.2 Resumen de la arquitectura

- **Núcleo** (se queda, modernizado): `Sources/Core/**` (red, auth, cachés, modelos, dominio) y
  `Sources/Player/**` (motor AVPlayer, máquina, directo, servicio, reproductor, capa única, PiP, pantalla
  de bloqueo), más el port de `session.ts` (hoy `CentroPartidoModelo`) y el emparejamiento. Se le aplican
  los 10 cambios obligatorios de a8 §3.11 y se le **quita** el estado de presentación.
- **Nuevo en el núcleo**: `Core/Datos` (caché de consultas al estilo TanStack, tiempo real con estados y
  respaldo, sondeos, identidad, capacidades 0.8.1, versión del servidor) y `Core/Reglas` (los ports puros
  de la web con vectores).
- **Interfaz nueva**: `Sources/Palco` (sistema de diseño), `Sources/Armazon` (raíz, barras, capa del
  partido, hojas, menús, avisos, orientación, gestos del sistema) y `Sources/Pantallas` (una carpeta por
  vista de la web + Emparejar).
- **Depuración**: `Sources/Debug` con el **servidor demo** que sirve los mismos datos que `?demo=1` (datos
  estáticos generados desde la web + algoritmos dinámicos portados y comprobados contra golden generados
  desde la web).

### 0.3 Decisiones de Isma que corrigen a1-a9 (y cómo quedan)

| Tema | a1-a9 decían | Queda (decisión de Isma) |
|---|---|---|
| Cristal | material + tinte; «no usar `glassEffect`» (a1 §13.6, a2 §21.4) | **`glassEffect` de iOS 26** en lo que en la web es cristal; con transparencia reducida, sólido (§B.7) |
| Hojas | hoja propia `PalcoSheet` (a2 §21.7) | **`.sheet` nativa** con `presentationDetents` y asa del sistema; contenido de la web (§C.7) |
| Menús | menú propio en un punto, sin vista previa (a2 §21.8) | **`Menu` y `.contextMenu` nativos con vista previa**; contenido y orden de la web (§C.8) |
| Háptica al abrir un menú contextual | «añadido `medium`» (a1 §8.1) / «sin vibración» (a4 §5.7) | la del sistema (`.contextMenu` ya vibra): **no** se añade otra |
| Pestaña activa | «no hace nada» (a2 §4.4) | **sube arriba** (costumbre de iOS) |
| Tirar para actualizar | no existe en la web | **en la agenda** (`.refreshable`) |
| Cifras | sin animación salvo el giro en paleta (a1 §3.5) | el giro en paleta al destapar se queda; **las cifras del marcador ruedan** al cambiar (gol) |
| Doble toque en el vídeo | nada (a4 §24-4) | **pantalla completa** (gira a horizontal inmersivo) |
| Deslizar el vídeo a los lados | no existe | **cambia de fuente** (misma acción que «Emitiendo» ‹ ›) |
| Transición tarjeta → teatro | capa viajera `partido-<id>` (a3 §4.8) | **zoom de elemento compartido** propio (§C.9), no `navigationTransition(.zoom)` (§C.9.3 explica por qué) |
| Accesos rápidos del icono (a2 §25) | se añaden | **fuera** de la 0.8.1 (Safari no los tiene; regla 1 de Isma) |
| iPad | pendiente (a8 §13) | **solo iPhone** (`TARGETED_DEVICE_FAMILY = 1`) |
| Fallos de la web (zonas seguras, menús cortados, hápticas no cableadas, cápsulas sin color con transparencia reducida, barra superior 52/64) | «calcar o no» | se hace bien: `safeL` respetado, menús del sistema, hápticas de la tabla a1 §8.1, cápsulas rojo/oro también opacas; barra superior **64** (lo que se ve) |

---

## A) Estructura de ficheros, `project.yml` e `Info.plist`

### A.1 Árbol de `Sources/` (estado de cada pieza)

Leyenda: **[Q]** se queda tal cual · **[M]** se queda con cambios (a8 §3.11) · **[N]** nuevo ·
**[B]** se borra · **[G]** generado por script (no se edita a mano) · **[L]** entra en el paquete
Linux (Foundation únicamente).

Se conservan los nombres de carpeta del núcleo (`Core`, `Player`) para no mover 60 ficheros: en un solo
módulo la ruta no cambia nada al compilar y el `git blame` se conserva.

```
Sources/
├─ App/
│  ├─ AceNeoApp.swift                  [M] reescrito (~60 líneas): migración de claves, Entorno, SesionApp, RaizView
│  ├─ Entorno.swift                    [M] + `reloj: any Reloj`, + `modo: ModoApp` (vivo/demo), + argumentos nuevos
│  ├─ SesionApp.swift                  [N] la parte «núcleo» de AppModel (a8 §3.2): fase, conexión, identidad, arranque
│  ├─ MigracionClaves.swift            [N][L] a1 §13.10
│  ├─ AppModel.swift                   [B] (se parte en SesionApp + DatosApp + Navegador + PresentacionReproductor)
│  └─ RootView.swift                   [B]
├─ Core/
│  ├─ Auth/            Emparejamiento [Q][L] · Llavero [Q] · Servidores [M][L] (PairingLink con varias `u=`, «Red de casa»)
│  ├─ Cache/           DiskCache [Q] · CacheImagenes [M] (`byPreparingForDisplay`)
│  ├─ Models/          *.swift [Q][L] + Dispositivos/Salud ya existen; + `PairingCreateBody.alternateBaseUrls` [M]
│  ├─ Dominio/         Canales [M][L] (quitar `nonisolated(unsafe)`) · ParaTi [Q][L] · Hash.swift [N][L] (`normalizeHash`)
│  ├─ Networking/      APIClient [M] (plazo total, caché, reintento de dirección solo en GET, `@concurrent` NO)
│  │                   APIError [M][L] (textos de la web) · Endpoint [M][L] · ErrorCatalog [G][L]
│  │                   Rutas [M] (+5 rutas 0.8.1, plazos) · PlazosWeb.generado.swift [G][L]
│  │                   SSEParser [Q][L] · SSEClient [M] (esperas 3·2ⁿ, `Last-Event-ID` al volver) · ServerResolver [Q]
│  ├─ Datos/                                                                  [N]
│  │  ├─ Consulta.swift               caché de una consulta (TanStack mínimo)            §E.2
│  │  ├─ DatosApp.swift               todas las consultas de la app + invalidación       §E.2
│  │  ├─ RutaConsulta.swift       [L] enum de rutas de caché                              §E.3
│  │  ├─ EfectosEvento.swift      [L] SSE → efectos (tabla a7 §6.3-6.4), puro             §E.3
│  │  ├─ TiempoReal.swift             estados idle/conectando/abierto/respaldo/demo      §E.4
│  │  ├─ EsperaSSE.swift          [L] 3·2^min(n−1,5), tope 60                              §E.4
│  │  ├─ Sondeos.swift                tareas de marcadores / precalentado / respaldo     §E.5
│  │  ├─ Identidad.swift          [L] viewerId `v_`+14 por proceso, deviceId              §E.6
│  │  ├─ Capacidades.swift        [L] memo 403 `origin_forbidden` (0.8.0)                 §E.7
│  │  ├─ VersionServidor.swift        a7 §5.2                                             §E.7
│  │  └─ BajasPendientes.swift        «Deshacer» de 6 s de la biblioteca                  §E.8
│  ├─ Reglas/                                                           [N][L] todo puro, con vectores   §E.9
│  │  ├─ Agenda/  RelojMadrid, DominioAgenda (domain.ts), TarjetasAgenda (cards.ts), Destapado (score-reveal.ts),
│  │  │           SenalPartido (useMatchSignal), ReglasMarcadores (scoresWanted/Interval)
│  │  ├─ Color/   ColorOKLab (lib/color.ts), Equipos (lib/teams.ts)
│  │  ├─ Biblioteca/ ModeloBiblioteca (library/model.ts), EnAntena (on-air.ts), Zapping (player/zapping.ts)
│  │  ├─ Buscar/  ModeloBuscar (search/model.ts) · Listas/ ModeloListas (directories/model.ts)
│  │  ├─ Gustos/  ModeloGustos (preferences/model.ts) · Donde/ ModeloDonde (where-playing/model.ts)
│  │  ├─ Salud/   ModeloSalud (health/model.ts, summarizeEngine) · Dispositivos/ ModeloDispositivos (devices/model.ts)
│  │  ├─ Avisos/  ColaToasts (notices/toasts.ts), LineaEstado (statusLine.ts), Redaccion (wording)
│  │  ├─ Reproduccion/ EstadoVisible (player/status.ts: statusFor, liveButton, stageMessage, IDLE_MESSAGES)
│  │  ├─ Gestos/  Deslizamiento (lib/gestures.ts classifySwipe), UmbralesGestos (mini 72, vídeo 56, borde 0,35·ancho)
│  │  ├─ Maquetacion/ Maquetacion (lib/media.ts + fórmulas de a2 §3.2, §8.2, §16; a1 §10.20), AltoHeroe
│  │  ├─ Formatos/ FechasES (tablas propias ene…dic, lun…dom), NumerosES (coma decimal), Plurales
│  │  └─ Navegacion/ Destino (routes.ts: parse de `?vista=`, profundidad, sentido)
│  └─ Emparejar/                                                          [M] (desde Features/Pairing)
│     ├─ ModeloEmparejar.swift         PairingViewModel + estados de cámara (a2 §22.3.1) + pausa 60 s
│     └─ EscanerQR.swift               QRScannerView (+ rectOfInterest, RotationCoordinator)
├─ Player/
│  ├─ MotorVideo, MaquinaConexion [L], Directo [L]                         [Q]
│  ├─ MotorAVPlayer                                                        [M] primer fotograma con isReadyForDisplay + 0,05 s
│  ├─ Reproductor                                                          [M] sin `expandido/superficiesGrandes/vista`, textos web, modo `aceneo-pb`
│  ├─ ServicioReproduccion                                                 [M] IdentidadVisor → Core/Datos/Identidad
│  ├─ ControlesSistema                                                     [M] metadatos y comandos de la web (stop, −30 s)
│  ├─ SuperficieVideo                                                      [Q] (capa única; `PrioridadHueco` sin cambios)
│  ├─ GestosReproductor                                                    [B] → Core/Reglas/Gestos (números de la web)
│  ├─ ReproductorVistas                                                    [B]
│  └─ Fuentes/                                                             [M]
│     ├─ SesionFuentes.swift           ex CentroPartidoModelo, con `EntornoSesionFuentes` en vez de `unowned AppModel`
│     └─ ReglasFuentes.swift       [L] ex Features/Sources/ReglasFuentes (revalidado con vectores de model.ts)
├─ Palco/                                                                  [N] sistema de diseño (§B)
│  ├─ Tokens/   Colores.generado.swift [G] · Medidas.swift · Sombras.swift · Movimiento.swift · Cristal.swift
│  ├─ Tipografia/ Mona.swift · EstiloTexto.swift · AltoDeLinea.swift · Num.swift
│  ├─ Iconos/   Iconos.generado.swift [G] · Icono.swift · IconoUIKit.swift
│  ├─ Haptica/  Haptica.swift · HapticaRaiz.swift
│  ├─ Componentes/ una vista por primitiva de a1 §10 (lista en §B.9)
│  └─ Galeria/  SistemaView.swift (galería «Sistema», 7 toques en «Versión»)
├─ Armazon/                                                                [N] (§C)
│  ├─ RaizView.swift · AppShell.swift · MedidasVentana.swift · Navegador.swift
│  ├─ BarraPestanas.swift · BarraSuperior.swift · VeloInferior.swift
│  ├─ CapaAvisos.swift · Avisos.swift · CapaPartido.swift · TransicionZoom.swift · BordeAtras.swift
│  ├─ Hojas.swift (router de `.sheet`) · Menus.swift (`AccionMenu`, `ContenidoMenu`, `.menuContextual`)
│  ├─ SubeConLaBarra.swift (sonda `scrollsToTop`) · Orientacion.swift · Tema.swift
│  └─ PresentacionReproductor.swift (mini/teatro/inmersivo, controles, autoocultado)
├─ Pantallas/                                                              [N] (una carpeta por vista de la web)
│  ├─ Agenda/  AgendaView, HeroeAgenda, TiraDias, FilaFiltro, CarruselCompeticion, TarjetaPartido, PrimerUso, PieAgenda, EstadoAgenda
│  ├─ Partido/ TeatroView, EscenarioVideo, ControlesVideo, CapsulaMarcador, CabeceraPartido, PestanasTeatro,
│  │           PanelFuentes, CartelFuente, BarraEmitiendo, Inspector, PanelPartido, DatosTecnicos, CanalSuelto, MiniReproductor
│  ├─ Canales/ CanalesView, EmitiendoAhora, CartelCanal, FilaCanal, PanelBiblioteca
│  ├─ Buscar/  BuscarView, EnlaceDetectado · Pegar/ HojaPegar
│  ├─ Hojas/   HojaGustos, HojaReportar, HojaEncontrarCanal, HojaGuardarFavorito, HojaRenombrar, HojaAyuda, HojaOtroServidor
│  ├─ Ajustes/ AjustesView, IndiceChips, SeccionListas, SeccionFutbol, SeccionReproduccion, SeccionDonde, SeccionApariencia,
│  │           SeccionDispositivos, QRPalco, SeccionServidor, SeccionSalud, SeccionMotor, SeccionAcerca, AvisoVersion
│  └─ Emparejar/ EmparejarView, CartelCamara, TarjetaCodigo
├─ Debug/                                                                  [M] solo `#if DEBUG`
│  ├─ DemoNucleo/ [N][L] RelojDemo, AgendaDemo, FuentesDemo, BuscarDemo, SaludDemo, DispositivosDemo, EstadoDemo, RutasDemo
│  ├─ ServidorDemo.swift [N] (URLProtocol que llama a RutasDemo) · SSEDemo.swift [N]
│  ├─ ServidorSimulado.swift [B] (sustituido por ServidorDemo) · MotorSimulado.swift [M] (+ imagen de demo)
│  └─ ImagenDemo.swift [N] (el campo de fútbol dibujado de `player/index.tsx › DemoPicture`)
├─ Design/ **[B] entero** · Features/ **[B] entero** (lo rescatable ya está arriba)
└─ Sonda/  [N, temporal] canarios de API (§G.3); se borra al cerrar la ola 0
```

### A.2 Árbol de `Tests/`

```
Tests/AceNeoTests/
├─ Ayudas.swift                        [Q] MockURLProtocol, Fixtures, ComparadorJSON, LlaveroSimulado… (+ `Recursos.url(_:)`)
├─ APIClientTests, SSETests, LlaveroTests, EmparejamientoTests, FixturesTests,
│  MotorAVPlayerTests, ReproductorTests, SistemaTests, InfoPlistTests, CacheYFormatoTests*  [M] (a8 §5; *sin FormatoAgenda)
├─ MaquinaYDirectoTests                [M] visor `v_`+14
├─ ReproductorVisibleTests             [M] se quedan SuperficieUnica y PiP (adaptadas); fuera GestosReproductor/VistaReproductor
├─ CentroPartidoTests → SesionFuentesTests [M] + port de `session.test.ts`
├─ PalcoTests, AgendaYBibliotecaTests  [B] (reescritas como vectores)
├─ VectoresDominioTests                [Q] (+ nuevas familias abajo)
├─ Vectores/                           [G] un JSON por módulo web (agenda-domain.json, agenda-cards.json, color.json, teams.json,
│                                          sources-model.json, library-model.json, on-air.json, zapping.json, search.json,
│                                          directories.json, preferences.json, where-playing.json, health.json, devices.json,
│                                          notices.json, status.json, gestures.json, media.json, routes.json, hash.json, wording.json)
├─ Reglas/  VectoresAgendaTests, VectoresColorTests, … (uno por JSON; mismo patrón que VectoresDominioTests) [N][L]
├─ Datos/   ConsultaTests, EfectosEventoTests, TiempoRealTests, SondeosTests, CapacidadesTests, IdentidadTests [N]
├─ Demo/    golden/*.json [G] + DemoGoldenTests.swift [N][L]
├─ Palco/   TokensTests (hex = tokens.css), FuenteMonaTests (PostScript + ejes), IconosTests (52, nombres), NumTests [N]
└─ App/     MigracionClavesTests, DestinoVistaTests [N]

Tests/AceNeoUITests/
├─ AyudasUI.swift                      [M] `tocarPestana` → `app.buttons["pestana-<id>"]`; `sePinta` se queda
├─ ServidorDePruebas.swift, ServidorRealUITests.swift   [M] identificadores nuevos (E2E contra el backend real)
├─ EmparejamientoUITests, ReproduccionUITests, CapturasUITests   [B] → reescritas:
├─ FlujosUITests.swift                 [N] emparejar, partido→mini→gestos→deshacer, hojas, menús, subir arriba
├─ CapturasWebUITests.swift            [N] una captura por vista y estado × tema × orientación (§F.5)
└─ OrientacionUITests.swift            [N] giro en caliente, inmersivo, ⛶
```

### A.3 `project.yml` (cambios)

```yaml
name: AceNeo
options:
  bundleIdPrefix: es.ismaeloul
  deploymentTarget:
    iOS: "26.0"                         # antes 17.0
  developmentLanguage: es
  createIntermediateGroups: true
  groupSortPosition: top
  generateEmptyDirectories: false

settings:
  base:
    SWIFT_VERSION: "6.0"                # modo de lenguaje 6 (compilador 6.2 del Xcode 26.6): NO cambiar (R1)
    SWIFT_STRICT_CONCURRENCY: complete  # redundante en modo 6, se deja: documenta la intención
    IPHONEOS_DEPLOYMENT_TARGET: "26.0"
    TARGETED_DEVICE_FAMILY: "1"         # solo iPhone
    ENABLE_USER_SCRIPT_SANDBOXING: YES
    LOCALIZATION_PREFERS_STRING_CATALOGS: YES
    DEAD_CODE_STRIPPING: YES
    CODE_SIGN_STYLE: Automatic
    DEVELOPMENT_TEAM: ""
    # NO se añaden SWIFT_DEFAULT_ACTOR_ISOLATION ni SWIFT_APPROACHABLE_CONCURRENCY (R1)
  configs:
    Debug:
      SWIFT_OPTIMIZATION_LEVEL: "-Onone"
      # Los cuerpos lentos salen como aviso y la CI los convierte en fallo (§G.5)
      OTHER_SWIFT_FLAGS: "$(inherited) -Xfrontend -warn-long-expression-type-checking=200 -Xfrontend -warn-long-function-bodies=400"
    Release:
      SWIFT_OPTIMIZATION_LEVEL: "-O"
      SWIFT_COMPILATION_MODE: wholemodule

targets:
  AceNeo:
    type: application
    platform: iOS
    sources:
      - path: Sources
      - path: Resources            # incluye Resources/Fuentes/*.ttf y Resources/Demo/*.json
    settings:
      base:
        PRODUCT_NAME: AceNeo
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID)
        INFOPLIST_FILE: Config/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: AccentColor
        ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS: NO
        ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS: NO   # se queda: menos superficie generada
        ENABLE_PREVIEWS: NO                                 # sin Xcode no sirven; menos código compilado
        SUPPORTS_MACCATALYST: NO
        SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: NO
      configs:
        Release:
          # Los JSON del servidor demo no van en la IPA (el código que los lee es #if DEBUG).
          EXCLUDED_SOURCE_FILE_NAMES: "Demo-*.json"
  AceNeoTests:     # igual que hoy + las carpetas nuevas de recursos
    sources:
      - path: Tests/AceNeoTests
      - path: ../../packages/shared/fixtures
        type: folder
        buildPhase: resources
  AceNeoUITests:   # igual que hoy
```

Notas:
- `Config/AceNeo.xcconfig`: `MARKETING_VERSION = 0.8.1`; `ACE_BUNDLE_ID` y `ACE_DISPLAY_NAME = Ace Neo` **sin
  cambios** (mismo bundle id, nombre e icono que la app actual, decisión 8).
- `Resources/Assets.xcassets`: se quedan `AppIcon` (las tres variantes de hoy: decisión 8, «mismo icono»),
  `AccentColor`, `Colores/Bg.colorset` (lo exige `UILaunchScreen`) y `Marca.imageset` (pasa a una sola
  variante, la oscura, a8 §7.4). Se **borran** los otros 22 colorsets (los colores van en código, §B.2).
  `generar-recursos.mjs` deja de escribirlos (se quita la tabla `PALCO`).
- `Resources/Fuentes/`: `MonaSans-Variable.ttf` (185 304 B), `MartianMono-Variable.ttf` y `OFL.txt`,
  convertidos **una vez** con fontTools (a1 §3.7) por `scripts/generar-fuentes.py` (`--check` compara el
  SHA-256 del woff2 de origen con el anotado en `Resources/Fuentes/ORIGEN.txt`). Son binarios pequeños y se
  commitean: la CI no necesita Python para compilar.

### A.4 `Config/Info.plist` (cambios)

| Clave | Valor |
|---|---|
| `UIAppFonts` | `Fuentes/MonaSans-Variable.ttf`, `Fuentes/MartianMono-Variable.ttf` (la ruta es relativa al bundle: XcodeGen copia la carpeta como grupo, así que van en la raíz; comprobarlo en `InfoPlistTests` con `Bundle.main.url(forResource:)` y `CTFontManagerCopyAvailablePostScriptNames`) |
| `UIBackgroundModes` | `audio` (ya está) |
| `CFBundleURLTypes` | esquema `aceneo` (ya está) |
| `UISupportedInterfaceOrientations` | vertical + horizontal izquierda/derecha (ya está); **se quita** `~ipad` |
| `NSCameraUsageDescription`, `NSLocalNetworkUsageDescription`, ATS | sin cambios |
| `UIApplicationShortcutItems` | **no** (fuera de la 0.8.1, §0.3) |
| comentarios «iOS 17 como mínimo» | se actualizan |

`InfoPlistTests` añade: fuentes registradas, familia solo iPhone, sin `~ipad`.

### A.5 Scripts (en `apps/ios/scripts/`, todos con `--check` para la CI)

| Script | Entrada | Salida | Nuevo |
|---|---|---|---|
| `generar-catalogo-errores.mjs` | `packages/shared/src/errors.ts` | `Core/Networking/ErrorCatalog.swift` | no |
| `generar-vectores.mjs` → **`generar-vectores.ts`** (con `tsx`) | módulos de la web (lista en §E.9) | `Tests/AceNeoTests/Vectores/*.json` | se amplía |
| `generar-tokens.mjs` | `apps/web/src/styles/tokens.css` (bloques hex de `:root` y `:root[data-scheme='dark']`) | `Palco/Tokens/Colores.generado.swift` | sí |
| `generar-iconos.mjs` | `apps/web/src/ui/icons.ts` | `Palco/Iconos/Iconos.generado.swift` | sí |
| `generar-plazos.mjs` | `apps/web/src/api/client.ts` (`TIMEOUTS`…), `features/sources/session.ts` (`RESOLVE_TIMEOUT_MS`…) | `Core/Networking/PlazosWeb.generado.swift` | sí |
| `generar-demo.ts` (con `tsx`) | `apps/web/src/api/demo/index.ts` + `features/*/demo*.ts` con el reloj fijo | `Resources/Demo/Demo-*.json` + `Tests/AceNeoTests/Demo/golden/*.json` | sí |
| `revisar-swift.mjs` | `Sources/**/*.swift`, `Tests/**/*.swift` | informe; código 1 si hay faltas | sí |
| `generar-fuentes.py` | woff2 de `@fontsource-variable` | `Resources/Fuentes/*.ttf` | sí (se ejecuta rara vez) |
| `comparar-capturas.py` | capturas del simulador + `design-explorations/capturas/_revision/web-palco/final` | informe HTML de diferencias (informativo) | sí |

Los scripts `.ts` se lanzan con `pnpm exec tsx scripts/<x>.ts` desde `ace-player-neo/` (`tsx` ya es
dependencia de desarrollo del monorepo): resuelve `@ace/shared` y los `import type` de `.tsx` sin tocar la
web. Los módulos de la web que usan `localStorage` o `Date` se ejecutan con dos calzos al principio del
script (`globalThis.localStorage` en memoria y un `Date` con reloj fijo, §F.2).

### A.6 Paquete espejo para Linux (`apps/ios/Package.swift`)

No sustituye al proyecto de Xcode (XcodeGen lo ignora): solo compila y prueba en Linux los mismos ficheros
marcados [L].

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NucleoPuro",
    platforms: [.macOS(.v15), .iOS(.v18)],
    targets: [
        .target(
            name: "NucleoPuro",
            path: "Sources",
            sources: [
                "Core/Models", "Core/Dominio", "Core/Reglas",
                "Core/Networking/Endpoint.swift", "Core/Networking/ErrorCatalog.swift",
                "Core/Networking/PlazosWeb.generado.swift", "Core/Networking/SSEParser.swift",
                "Core/Networking/APIError.swift", "Core/Auth/Servidores.swift",
                "Core/Datos/RutaConsulta.swift", "Core/Datos/EfectosEvento.swift", "Core/Datos/EsperaSSE.swift",
                "Core/Datos/Identidad.swift", "Core/Datos/Capacidades.swift", "Core/Datos/Reloj.swift",
                "Player/MaquinaConexion.swift", "Player/Directo.swift", "Player/Fuentes/ReglasFuentes.swift",
                "App/MigracionClaves.swift", "Debug/DemoNucleo",
            ],
            swiftSettings: [.swiftLanguageMode(.v6)]),
        .testTarget(
            name: "NucleoPuroTests",
            dependencies: ["NucleoPuro"],
            path: "Tests/AceNeoTests",
            sources: ["Reglas", "Demo", "VectoresDominioTests.swift", "SSEParserTests.swift", "Datos/EfectosEventoTests.swift"],
            resources: [.copy("Vectores"), .copy("Demo/golden")]),
    ])
```

- Los tests compartidos empiezan con `#if SWIFT_PACKAGE @testable import NucleoPuro #else @testable import AceNeo #endif`
  y leen recursos con `Recursos.url(_:)` (`Bundle.module` en SwiftPM, `Bundle(for:)` en Xcode).
- Los ficheros de red usan `#if canImport(FoundationNetworking) import FoundationNetworking #endif`
  (inocuo en iOS). `DiskCache`, `Llavero`, `CacheImagenes` y todo lo de AVFoundation/UIKit/SwiftUI quedan fuera.
- Dos movimientos pequeños para que el conjunto [L] se cierre sobre sí mismo (se hacen en la ola 1):
  `CanalReproducible`, `ContextoPartido`, `OrigenReproduccion` y `MotivoParada` salen de
  `ServicioReproduccion.swift`/`Reproductor.swift` a `Player/TiposReproduccion.swift` [L] (los usan
  `ReglasFuentes` y `EstadoVisible`); y `SSEParserTests` se separa de `SSETests.swift` a su propio fichero
  (hoy comparten fichero con las pruebas del cliente, que necesitan `URLProtocol` de Apple).
- En el PC de Isma: `docker run --rm -v "%CD%":/w -w /w/ace-player-neo/apps/ios swift:6.2 swift test`
  (Docker Desktop ya está instalado). Sin Docker, el job `nucleo-linux` de la CI hace lo mismo en ~3 min.

---

## B) Sistema de diseño (`Sources/Palco`)

### B.1 Reglas generales

- Todo `Color`, `Font`, radio, sombra, animación y háptica sale de `Palco`: el revisor (§G.5) prohíbe
  `Color(red:…)`, `.font(.body…)`, `Font.custom`, `.foregroundColor(`, `.cornerRadius(`, `Animation.easeInOut`
  y `.sensoryFeedback(` fuera de `Sources/Palco`.
- Radios **circulares** (`RoundedRectangle(cornerRadius: r, style: .circular)`), no continuos (a1 §13.4).
- Islas oscuras (a1 §0.2): `.islaOscura()` = `.environment(\.colorScheme, .dark)` en tarjeta versus,
  cápsulas de cristal, pastilla de competición, cabecera sobre el héroe, primer uso, todo lo que va sobre el
  vídeo y el cartel de la cámara.

### B.2 Color (código, no catálogo)

`scripts/generar-tokens.mjs` lee los bloques **hex** de `tokens.css` (en oscuro manda el bloque
`[data-scheme='dark']`, a1 §0.1; en claro el hex de respaldo coincide con el OKLCH) y escribe:

```swift
// Palco/Tokens/Colores.generado.swift — GENERADO, no editar
import SwiftUI
import UIKit

extension Color {
    /// Color dinámico sRGB: se resuelve con el esquema del subárbol (islas oscuras incluidas).
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1) {
        self.init(uiColor: UIColor { (rasgos: UITraitCollection) -> UIColor in
            rasgos.userInterfaceStyle == .dark
                ? UIColor(hex: oscuro, alfa: alfaOscuro)
                : UIColor(hex: claro, alfa: alfaClaro)
        })
    }
}

public enum Palco {
    public static let bg = Color(claro: 0xF3F3F4, oscuro: 0x05070A)
    public static let bgSunk = Color(claro: 0xE9E9EB, oscuro: 0x020305)
    public static let surface = Color(claro: 0xFFFFFF, oscuro: 0x0F1218)
    public static let lineSoft = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF, alfaClaro: 0.08, alfaOscuro: 0.10)
    public static let accent = Color(claro: 0xFFD60A, oscuro: 0xFFD60A)
    public static let glassVideo = Color(claro: 0x090C11, oscuro: 0x090C11, alfaClaro: 0.62, alfaOscuro: 0.62)
    // … los 40 tokens de a1 §2.1-2.2 + las mezclas resueltas de a1 §2.3 (liveCapsula #B1231A/#D12E25…)
}
```

- Tipos explícitos en el cierre del `UIColor` (lección a8 §9.2). `UIColor(hex:alfa:)` es una extensión
  escrita a mano en `Palco/Tokens/UIColorHex.swift`.
- Las mezclas con colores de **club/canal** no son tokens: salen de `Core/Reglas/Color` (port de
  `lib/color.ts`, OKLab) y se convierten a `Color` en la vista.
- Test `TokensTests`: el generador escribe también `Tests/AceNeoTests/Palco/tokens.json` y el test compara
  cada `Color` resuelto en `UITraitCollection(userInterfaceStyle:)` con ese JSON (a8 §7.5).

### B.3 Tipografía

```swift
// Palco/Tipografia/Mona.swift
import CoreText
import SwiftUI
import os

/// Única fábrica de fuentes de la app (a1 §3.7, a2 §21.3). Nunca `Font.custom`.
public enum Mona {
    static let wdth = 0x7764_7468   // 'wdth'
    static let wght = 0x7767_6874   // 'wght'
    private struct Clave: Hashable, Sendable { let tamano: Double; let peso: Double; let anchura: Double; let mono: Bool }
    private static let cache = OSAllocatedUnfairLock<[Clave: Font]>(initialState: [:])

    /// Mona Sans con los DOS ejes siempre fijados (el defecto del fichero es wght 200).
    public static func font(_ tamano: CGFloat, peso: CGFloat, anchura: CGFloat = 100) -> Font
    /// Martian Mono (`MartianMono-SemiExpandedRegular`), anchura 87,5 por defecto.
    public static func mono(_ tamano: CGFloat, peso: CGFloat = 400, anchura: CGFloat = 87.5) -> Font
    /// Para los tests y para `IconoUIKit`: el `CTFont` real.
    public static func ctFont(_ tamano: CGFloat, peso: CGFloat, anchura: CGFloat, mono: Bool = false) -> CTFont
}
```

Trampa de compilación evitada: a1 §13.3 proponía `static let` de `Font` en una extensión llamando a un
`@MainActor enum Mona`; en Swift 6 un inicializador de `static let` es no aislado y **no puede** llamar a
algo `@MainActor`. Por eso `Mona` es **no aislado** con caché bajo `OSAllocatedUnfairLock` (y `Font` es
`Sendable`).

Roles (a1 §3.4, a3 §1.4.1) como datos, no como `static let Font`:

```swift
public enum EstiloTexto: Sendable {
    case titularVista, titularVistaAncha, subtituloVista, tituloHoja, tituloVacio, tituloSeccion
    case kicker, cuerpo, boton, botonPequeno, chip, capsula, capsulaPequena, senal, segmentado
    case itemMenu, toast, lineaEstado, etiquetaCampo, campo, pista, error, mono
    case cifras(CGFloat)           // wdth 75 / wght 780
    public var tamano: CGFloat { get }
    public var peso: CGFloat { get }
    public var anchura: CGFloat { get }
    public var tracking: CGFloat { get }      // em × tamaño, ya en pt
    public var altoDeLinea: CGFloat { get }   // factor CSS (1,1 / 1,25 / 1,45…)
    public var mayusculas: Bool { get }
}

extension View {
    /// Fuente + tracking + mayúsculas (`.textCase(.uppercase)` con es_ES) + corrección de alto de línea de UNA línea.
    public func estilo(_ e: EstiloTexto) -> some View
    /// Caja de línea CSS: `.padding(.vertical, (lh − 1,41) × tamaño / 2)` (a1 §13.3). Mona mide 1,41 em.
    public func altoDeLinea(_ lh: CGFloat, tamano: CGFloat) -> some View
}
```

- **Varias líneas con `lh < 1,41`** (títulos de vacío, de hoja y toasts de dos líneas): en la ola 0 el
  canario prueba si el SDK 26.5 trae un modificador de alto de línea para `Text`; si existe, se usa; si
  no, se acepta la diferencia (≈ 3 pt por línea extra) y se anota para una ola de pulido (un
  `UILabel` con `NSParagraphStyle` solo si las capturas lo piden). No se escribe el `UILabel` de entrada:
  es código UIKit extra sin forma de probarlo en local.
- **Dynamic Type**: tamaños fijos (a2 §26). Raíz con `.font(Mona.font(15, peso: 450))`; el revisor prohíbe
  `.font(.body/.headline/…)`, `Font.custom(` y `@ScaledMetric`. Se añade
  `.accessibilityShowsLargeContentViewer()` a pestañas, controles del vídeo e `IconButton`.
- **`Num`** (a1 §3.5):

```swift
public struct Num: View {
    public init(_ valor: String, tamano: CGFloat, condensado: Bool = true,
                etiqueta: String? = nil, rueda: Bool = false)
    // HStack(alignment: .firstTextBaseline, spacing: 0) de celdas de 0,49 em (0,645 sin condensar);
    // separadores a su ancho; accessibilityElement(children: .ignore) + label.
    // rueda = true → cada celda con .contentTransition(.numericText(value:)) y Movimiento.estandar (decisión 3);
    // NUNCA .monospacedDigit() (cero con barra).
}
// Core/Reglas/Formatos/Cifras.swift [L]: `func partesNum(_ texto: String) -> [ParteNum]` (splitDigits), con vectores.
```

### B.4 Iconos (52, generados como `Shape`)

`scripts/generar-iconos.mjs` lee `ICONS` de `apps/web/src/ui/icons.ts`, convierte `rect` (con `rx`),
`circle` y `path` (relativos → absolutos; arcos `A/a` → cúbicas en tramos ≤ 90°) y escribe:

```swift
// Palco/Iconos/Iconos.generado.swift — GENERADO
public enum NombreIcono: String, CaseIterable, Sendable {
    case agenda, biblioteca, buscar, ajustes, play, pause, stop, vol, mute, back, full, pip, more
    case star, starF = "star-f", copy, paste, flag, refresh, check, learn
    case chevD = "chev-d", chevU = "chev-u", chevL = "chev-l", chevR = "chev-r"
    case tv, motor, nerd, hash, link, plus, list, clock, eye, eyeOff = "eye-off", panel, x, pencil, trash
    case kbd, sol, luna, pantalla, movil, qr, externo, info, aviso, ayuda, senal, directo, subir
}
enum TrazosIcono {
    /// Rejilla 24×24; una función por icono (sentencias, nunca una expresión larga: type-checker).
    static func trazo(_ n: NombreIcono) -> Path      // switch de 52 casos → funciones privadas
    static func relleno(_ n: NombreIcono) -> Path    // piezas `fill=currentColor stroke=none`
    private static func agenda() -> Path { var p = Path(); p.move(to: CGPoint(x: 7.5, y: 5)); … ; return p }
}
```

```swift
// Palco/Iconos/Icono.swift
public struct FormaIcono: Shape {
    public enum Parte: Sendable { case trazo, relleno }
    public init(_ nombre: NombreIcono, parte: Parte)
    public func path(in rect: CGRect) -> Path          // escala 24 → rect
}
public struct Icono: View {
    public init(_ nombre: NombreIcono, tamano: CGFloat = 24, relleno: Bool = false)
    // relleno = variante «relleno + trazo» del reproductor (a1 §10.1): fill + stroke 1,8·t/24 round/round
}
// Palco/Iconos/IconoUIKit.swift — para `Menu`, `.contextMenu` y etiquetas del sistema (solo aceptan Image)
@MainActor public enum IconoUIKit {
    public static func imagen(_ nombre: NombreIcono, tamano: CGFloat = 20) -> UIImage   // ImageRenderer, plantilla, caché
}
```

Nada de SF Symbols en la interfaz propia. `IconosTests`: 52 casos, mismos nombres que `ICONS`, y cada
`Path` con `boundingRect` dentro de 0…24.

### B.5 Espacios, radios, capas y medidas

```swift
public enum Espacio { public static let s1: CGFloat = 4, s2 = 8, s3 = 12, s4 = 16, s5 = 20, s6 = 24, s8 = 32, s10 = 40, s12 = 48
                      public static let gutter: CGFloat = 16, tap: CGFloat = 44 }
public enum Radio   { public static let xl: CGFloat = 24, l = 18, m = 14, s = 10, xs = 6
                      public static func interior(exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(6, exterior - relleno) } }
public enum Capa    { public static let sticky = 20.0, velo = 39.0, barra = 40.0, mini = 41.0, toasts = 60.0,
                      inmersivo = 100.0 }   // hojas y menús son del sistema
public enum Medidas { public static let barraPestanas: CGFloat = 64, huecoBarra = 10, barraSuperior = 64, mini = 72 /* nunca 64 */ }
```

### B.6 Sombras (incluidas las de extensión negativa)

```swift
public enum SombraPalco: Sendable {
    case uno            // 0 1 2 α.06/.35 + 0 8 24 −16 α.20/.45
    case dos            // 0 20 60 −20 α.22/.60
    case cartel         // 0 8 24 α.12/.45
    case cartelOscura   // siempre la oscura (islas)
    case hojaArriba     // 0 −20 60 −20 #000 α.5 (solo si hiciera falta)
    case video          // 0 6 18 −8 rgb(2 8 18) α.55
    case primario       // 0 2 8 #000 α.18 (+ brillo interior blanco α.35)
}
extension View {
    /// Extensión negativa = una forma ENCOGIDA |extensión| por lado, desplazada, desenfocada (blur CSS / 2),
    /// detrás y sin toques (a2 §21.5, a1 §13.6). Una capa por sombra.
    public func sombra<S: Shape>(_ s: SombraPalco, forma: S) -> some View
    /// Bordes interiores `inset 0 0 0 1px` → strokeBorder; brillo `inset 0 1 0` → forma.subtracting(forma.offset(y: 1)).
    public func bordeInterior<S: InsettableShape>(_ color: Color, forma: S, grosor: CGFloat = 1) -> some View
    public func brilloSuperior<S: Shape>(_ color: Color, forma: S) -> some View
}
```

`strokeBorder` exige `InsettableShape` (lección a8 §9.7): la firma ya lo obliga.

### B.7 Cristal: Liquid Glass de verdad, con transparencia reducida bien hecha

```swift
public enum TipoCristal: Sendable {
    case denso        // barra de pestañas, mini, toasts (web: --glass-dense)
    case regular      // barra superior en horizontal (web: --glass)
    case video        // controles y cápsulas sobre el vídeo, cápsula de estado (web: --glass-video)
    case videoBoton   // botón «video» del panel del vídeo (web: blanco 16 %)
}
@MainActor public enum CristalPalco {
    /// ÚNICO sitio donde se afinan los vidrios (tras verlos en el iPhone): tinte y si son interactivos.
    public static func vidrio(_ t: TipoCristal) -> Glass            // .regular.tint(…) / .clear.tint(…)
    public static func solido(_ t: TipoCristal) -> Color            // glassSolid / glassVideoSolid
    /// Cápsulas de cristal DENTRO de listas (versus de la agenda, carteles): glassEffect o material+tinte.
    public static var vidrioEnListas: Bool = true                   // interruptor de rendimiento (§H riesgo 6)
}
extension EnvironmentValues {
    /// `aceneo-transparencia == "reducida"` O `accessibilityReduceTransparency` (a1 §1.2). Lo pone la raíz.
    @Entry public var cristalOpaco: Bool = false
}
extension View {
    /// Con cristal: `.glassEffect(CristalPalco.vidrio(t), in: forma)`; opaco: forma.fill(solido) sin efecto.
    public func cristal<S: Shape>(_ t: TipoCristal, en forma: S) -> some View
}
```

| Pieza web (clase) | iOS 26 | Opaco |
|---|---|---|
| Barra inferior (`glass--dense`, radio 24) | `GlassEffectContainer { … }.cristal(.denso, en: .rect(cornerRadius: 24))` | `glassSolid` |
| Barra superior horizontal (`glass`) + capa densa tras 32 pt | `.cristal(.regular, en: Rectangle())` + capa `glassDense` con opacidad | `glassSolid` |
| Mini (`glass--dense`, radio 18) | `.cristal(.denso, en: .rect(cornerRadius: 18))` | `glassSolid` |
| Toast (radio 26) | `.cristal(.denso, en: .rect(cornerRadius: 26))` | `glassSolid` |
| Controles del vídeo, ⌄, cápsulas ☆·PiP·⋯, Directo·⛶ | `GlassEffectContainer` por fila + `.cristal(.video, en: .capsule)`; isla oscura | `#0F1218` |
| Cápsula de estado sobre el vídeo | `.cristal(.video, en: .capsule)` | `#0F1218` |
| Cápsulas de cristal en tarjetas versus y carteles | `.cristal(.video, en: .capsule)` con `GlassEffectContainer` por tarjeta (o material si `vidrioEnListas == false`) | `#0F1218`, **pero** las de tono `live`/`gold` conservan su rojo/oro (no se calca el fallo a1 §0.7) |
| Menús, hojas | los del sistema (ya son Liquid Glass) | los del sistema (respetan la accesibilidad) |

El tinte exacto de cada `Glass` no se puede fijar sin ver el iPhone: por eso vive en **una** función
(`CristalPalco.vidrio`), y la ola de pulido lo ajusta con capturas del simulador junto a las de la web.

### B.8 Movimiento (tabla web → SwiftUI)

```swift
public enum Movimiento {
    public static func rapido(_ reducido: Bool) -> Animation    // .spring(duration: 0.25, bounce: 0)   | .easeOut(0.12)
    public static func estandar(_ reducido: Bool) -> Animation  // .spring(duration: 0.4, bounce: 0.15) | .easeOut(0.15)
    public static func heroe(_ reducido: Bool) -> Animation     // .spring(duration: 0.55, bounce: 0.3) | .easeOut(0.15)
    public static let salida = Animation.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)
    public static let fundidoVista = Animation.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.34)
    public static let progreso = Animation.spring(duration: 0.615, bounce: 0.15)
    public static let pulso: Duration = .seconds(2)
    public static func escalonado(_ i: Int) -> Double { Double(min(i, 10)) * 0.036 }
}
```

| Token web | Duración CSS | SwiftUI | Usos |
|---|---|---|---|
| `--ease-rapido` | 340 ms | `rapido` | pulsar (`PressStyle`), aparecer anillo, píldora de día |
| `--ease-estandar` | 520 ms | `estandar` | píldora de la barra, gota del segmentado, toasts, mini, interruptor, escalonado |
| `--ease-heroe` | 800 ms | `heroe` | entrar al partido (zoom), paleta de cifras, gol |
| `--ease-out` / `--dur-fade` | 320 ms | `salida` | salidas de toasts y línea de estado |
| vistas (View Transitions) | 340 ms | `fundidoVista` + ±16 pt | cambio de pestaña |
| progreso | 800 ms | `progreso` | barras de progreso |
| ondas, latidos, giros | 2 s / 1,4 s / 1,6 s / 0,9 s | `TimelineView(.animation)` con la aritmética de a1 §13.5 | punto de directo, comprobando, esqueleto, ⟳ |
| mejoras nativas | — | `.snappy` en la píldora al arrastrar, `.bouncy` en el rebote del gol | decisión 3 |

Con «Reducir movimiento» todo pasa por el parámetro `reducido` (una sola lectura de
`accessibilityReduceMotion` por vista). Solo se animan `scaleEffect`, `offset`, `opacity` y
`rotation3DEffect` (regla de la web); los colores cambian sin animación.

### B.9 Primitivas (a1 §10) → ficheros de `Palco/Componentes`

`PressStyle` (escala 0,975 + velo 10 %), `BotonPalco` (variantes primary/quiet/ghost/glass/video/danger,
md/sm, pulsado, ocupado), `BotonIcono`, `Tarjeta`/`Panel` (+ `@Entry radioInterior`), `Chip`, `Capsula`,
`MedidorSenal` (`SignalBadge`), `AnilloSenal` (`SignalRing`), `PuntoDirecto` (`LiveDot`; `LiveRing` solo en
la galería), `BarraProgreso`, `MarcaEquipo` (`TeamMark`), `MarcaCanal` (`ChannelMark` redonda/tesela),
`PastillaCompeticion`, `TarjetaVersus`, `CarrilCarteles` (`PosterRail`), `Segmentado` y `Pestanas`
(gota con `offset` animado), `EstiloInterruptor` (`ToggleStyle` 52×32), `CampoTexto`, `EstadoVacio`,
`Esqueleto`/`FilasEsqueleto`, `CabeceraVista` (`ViewHeader` con `FlowRow`), `LineaEstadoVista`,
`ToastVista`, `FlowRow` (`Layout` de flujo), `ImagenServidor` (lee `CacheImagenes.enMemoria` y luego pide;
nunca `AsyncImage`).

Cada una: firma congelada en la ola 0 (stub que compila y pinta algo simple), cuerpo real en la ola 2.
Ejemplo de firma:

```swift
public struct TarjetaVersus: View {
    public enum Tamano: Sendable { case sm, md, lg, xl }
    public init(local: LadoVersus, visitante: LadoVersus, competicion: String,
                cuando: CuandoVersus, tamano: Tamano, estado: EstadoVersus = .normal,
                @ViewBuilder senal: () -> some View = { EmptyView() })
}
public struct LadoVersus: Sendable, Hashable { public var nombre, siglas: String; public var primario, secundario: RGB; public var escudo: URL?; public var encendido: Bool }
```

(`RGB` es el tipo de `Core/Reglas/Color` [L]; la vista lo convierte a `Color`.)

### B.10 Háptica (HAPTIC_MAP → `sensoryFeedback`)

```swift
public enum TipoHaptico: String, CaseIterable, Sendable { case seleccion, ligera, media, fuerte, rigida, exito, aviso, error }
// Core/Reglas/Gestos/ReglaHaptica.swift [L]
public enum ReglaHaptica {
    /// Nunca la misma sensación en < 40 ms; `seleccion` callada con «Reducir movimiento» (lib/haptics.ts).
    public static func suena(_ t: TipoHaptico, ahora: ContinuousClock.Instant,
                             ultimo: ContinuousClock.Instant?, reducirMovimiento: Bool) -> Bool
}
@MainActor @Observable public final class Haptica {
    public private(set) var pulsos: [TipoHaptico: Int] = [:]
    public func disparar(_ t: TipoHaptico)          // modelos y vistas llaman aquí; nunca `.sensoryFeedback` suelto
}
/// En la raíz: 8 `.sensoryFeedback` con tipos EXPLÍCITOS, repartidos en dos modificadores de 4 (type-checker).
struct HapticaRaiz: ViewModifier { … }   // .sensoryFeedback(SensoryFeedback.impact(weight: .light), trigger: n)
```

| `TipoHaptico` | `SensoryFeedback` |
|---|---|
| seleccion | `.selection` |
| ligera | `.impact(weight: .light)` |
| media | `.impact(weight: .medium)` |
| fuerte | `.impact(weight: .heavy)` |
| rigida | `.impact(flexibility: .rigid)` |
| exito / aviso / error | `.success` / `.warning` / `.error` |

Los sitios son **exactamente** la tabla de a1 §8.1 (columna «Nativo»), con una excepción por la decisión 5:
las pulsaciones largas que abren un `.contextMenu` **no** llaman a `disparar(.media)` (el sistema ya vibra).
Un test recorre `SitiosHapticos.todos` (tabla en código, [L]) para que nadie añada o quite sitios sin verlo.

---

## C) Armazón (`Sources/Armazon`)

### C.1 Raíz con dos fases (emparejar ↔ app)

```swift
@main
struct AceNeoApp: App {
    @State private var sesion: SesionApp
    init() {
        MigracionClaves.ejecutar()                         // antes de leer ningún @AppStorage (a1 §13.10)
        _sesion = State(initialValue: SesionApp(entorno: .actual()))
    }
    var body: some Scene {
        WindowGroup { RaizView().environment(sesion) }    // + scenePhase → sesion.cambioDeFase(_:)
    }
}

struct RaizView: View {   // a2 §27.2: las dos capas MONTADAS; se anima la opacidad, nunca un if/else animado
    @Environment(SesionApp.self) private var sesion
    var body: some View { ZStack { capaApp; capaEmparejar }.modifier(TemaRaiz()).modifier(HapticaRaiz()) }
    @ViewBuilder private var capaApp: some View { … }        // AppShell con opacity/allowsHitTesting/accessibilityHidden
    @ViewBuilder private var capaEmparejar: some View { … }  // EmparejarView
}
```

`TemaRaiz`: `.preferredColorScheme` desde `@AppStorage("aceneo-tema")`, `\.cristalOpaco`,
`.font(Mona.font(15, peso: 450))`, `.onOpenURL` (enlace `aceneo://pair`).

### C.2 Medir la ventana sin `GeometryReader` + `ignoresSafeArea`

Lección a8 §9.3 (`455264f`): nunca leer zonas seguras de un `GeometryReader` que ignora el área segura.

```swift
public struct MedidasVentana: Equatable, Sendable {
    public var tamano: CGSize
    public var seguro: EdgeInsets
    public var altoVentanaCompleta: CGFloat { tamano.height + seguro.top + seguro.bottom }
}
extension EnvironmentValues { @Entry public var medidas = MedidasVentana(tamano: .zero, seguro: EdgeInsets()) }

// AppShell: el fondo ignora el área segura SOLO en .background; el contenido no.
content
    .background { Palco.bg.ignoresSafeArea() }
    .onGeometryChange(for: MedidasVentana.self) { proxy in
        MedidasVentana(tamano: proxy.size, seguro: proxy.safeAreaInsets)
    } action: { medidas = $0 }
    .environment(\.medidas, medidas)
```

`Core/Reglas/Maquetacion/Maquetacion.swift` [L] es la función pura de todo el armazón (tests con las tablas
de a2 §3.2, §8.2, §16.6 y a1 §10.20):

```swift
public struct Margenes: Equatable, Sendable { public var arriba, abajo, izquierda, derecha: Double }
public struct Maquetacion: Equatable, Sendable {
    public enum Tipo: Sendable { case movil, tableta }                 // ancho < 768
    public init(ancho: Double, alto: Double, seguro: Margenes, enPartido: Bool, pantallaCompleta: Bool, miniVisible: Bool)
    public var tipo: Tipo
    public var bajoAlto: Bool                                          // alto ≤ 540
    public var inmersivo: Bool                                         // pantallaCompleta || (enPartido && horizontal && bajoAlto)
    public var barraInferior: Bool                                     // movil && !enPartido && !inmersivo
    public var barraSuperior: Bool                                     // tableta && !inmersivo
    public var bordeInferiorToasts: Double                             // safeB + 94 / + 178 / + 12 · tableta: 20 o 104
    public var anchoToasts: Double; public var toastsALaDerecha: Bool
    public var altoVelo: Double                                        // safeB + 100 / + 180
    public var rellenoInferiorContenido: Double                        // safeB + 102 / + 182 / partido + 28
    public var marcoMini: (x: Double, abajo: Double, ancho: Double)    // banda (movil) o tarjeta 440 (tableta)
    public func altoHeroe(altoVentanaCompleta: Double) -> Double       // min(500, max(360, 0,6·alto)) (a3 §4.7)
}
```

### C.3 Navegación (equivalente a `?vista=`)

```swift
// Core/Reglas/Navegacion/Destino.swift [L] — port de routes.ts
public enum Pestana: String, CaseIterable, Sendable { case agenda, canales, buscar, ajustes }
public enum PestanaBiblioteca: String, Sendable { case favoritos, recientes, listas }
public enum SeccionAjustes: String, CaseIterable, Sendable {
    case listas, futbol, reproduccion, donde, apariencia, dispositivos, servidor, salud, motor, acerca }
public enum Destino: Hashable, Sendable {
    case agenda, canales(PestanaBiblioteca?), buscar(String?), ajustes(SeccionAjustes?)
    case partido(String), canal(String), sistema
    public init?(vista: String)              // «partido/demo-1», «partido/canal/<hash40>», «ajustes/salud»…
    public var profundidad: Int              // routeDepth: 0,1,2,3 · partido 10 · sistema 11
    public var pestana: Pestana?
}
public enum Sentido: Sendable { case adelante, atras }

// Armazon/Navegador.swift
@MainActor @Observable public final class Navegador {
    public private(set) var pestana: Pestana = .agenda
    public private(set) var capa: Destino?                     // partido / canal / sistema encima de las pestañas
    public private(set) var sentido: Sentido = .adelante
    public private(set) var visitadas: Set<Pestana> = [.agenda]
    public var seccionAjustes: SeccionAjustes?
    public var pestanaBiblioteca: PestanaBiblioteca?
    public var textoBuscar: String?
    public var hoja: Hoja?                                     // la ÚNICA fuente de `.sheet` (§C.7)
    public var posiciones: [Pestana: ScrollPosition] = [:]     // memoria de scroll (y «subir arriba»)
    public func ir(_ d: Destino)                               // no-op si es el mismo; sentido por profundidad
    public func atras()                                        // saca la capa o va a la agenda
    public func tocarPestana(_ p: Pestana)                     // activa → posiciones[p].scrollTo(edge: .top) animado (decisión 3)
}
```

- Pestañas **vivas**: `ZStack` con `ForEach(visitadas)`; la inactiva con `opacity(0)`,
  `allowsHitTesting(false)`, `accessibilityHidden(true)` y **sus tareas pausadas** por una bandera `visible`
  (las vistas usan `.task(id: visible)`, a6 §14.1; `onDisappear` no se dispara en un `ZStack`).
- Cambio de pestaña: fundido 340 ms + ±16 pt según `sentido` (a2 §21.2); háptica `seleccion` solo si cambia.
- Memoria de scroll: cada pestaña con su `ScrollView` y su `ScrollPosition`; el partido usa
  `.id(partidoID)` para empezar arriba en un partido distinto.
- Tocar la barra de estado: sonda `SubeConLaBarra` (a2 §27.5) — solo la `ScrollView` visible con
  `scrollsToTop = true`; carriles horizontales siempre `false`.
- Debug: `-AceNeoVista partido/demo-1` → `Destino(vista:)` → `navegador.ir(_)` sin animación (capturas).

### C.4 Barra de pestañas propia en Liquid Glass (decisión 4)

```swift
struct BarraPestanas: View {
    // 4 celdas iguales: (ancho − 2 − 12) / 4 (= 88 a 390); alto 64; radio 24; a 12 + safe de los lados, safeB + 10 abajo
    // Píldora: RoundedRectangle(18) accentWash, 88×50, offset(x: índice·celda), Movimiento.estandar
    // Item: Button(.plain) · VStack(spacing: 2) { Icono(24); Text.estilo(.pestana) 11/620/88 } · accentInk / text2
    // Identificadores: "pestana-agenda", "pestana-canales", "pestana-buscar", "pestana-ajustes"
    // Accesibilidad: contenedor «Principal»; activa con .isSelected; .accessibilityShowsLargeContentViewer()
}
```

- Fondo: `GlassEffectContainer { HStack {…} }.cristal(.denso, en: .rect(cornerRadius: 24))`.
  La píldora **no** es vidrio en la primera entrega (morfología `glassEffectID` entre pestañas = mejora
  opcional tras el canario y una prueba en el iPhone).
- Teclado: la barra, el velo y el mini quedan detrás (`.ignoresSafeArea(.keyboard, edges: .bottom)` en
  esa capa), como en la web.
- Horizontal (tableta): `BarraSuperior` 64 + safeT, 4 destinos de 104 (icono 20 + texto 13), píldora
  cápsula 104×44, rayo del motor + «?» (que abre `HojaAyuda`), capa densa tras 32 pt con
  `onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 32 }`.

### C.5 Velo inferior, cabeceras y línea de estado

- `VeloInferior`: `LinearGradient` hacia arriba, `bg` opaco hasta 58 %, alto `maquetacion.altoVelo`, sin
  toques, oculto sin barra.
- `CabeceraVista`: título 30 (44 en tableta) con `.altoDeLinea(1.1, tamano:)`, subtítulo, «Modo demo» o
  indicador del motor (texto oculto si ancho ≤ 380), acciones; relleno superior `safeT + 20`.
- `LineaEstadoVista` + `LineaEstado` (port de `statusLine.ts`): vive en el teatro; aviso 4,5 s sobre un
  estado base que calcula `EstadoVisible.estadoBase(_:)` (§D.3).

### C.6 Avisos (toasts) y su posición exacta

```swift
// Core/Reglas/Avisos/ColaToasts.swift [L] — port literal de notices/toasts.ts (máx 2, 2,8 s, ×n, 6 s con acción)
public struct Toast: Identifiable, Equatable, Sendable { public let id: Int; public var texto: String; public var tono: TonoAviso
    public var icono: String?; public var accion: String?; public var repeticiones: Int; public var caducaEn: Duration }
public enum TonoAviso: String, Sendable { case ok, info, warn, err }
public struct ColaToasts: Sendable { public mutating func anadir(_:ahora:) -> …; public mutating func caducar(ahora:) }

// Armazon/Avisos.swift — el `notify()` de la web
@MainActor @Observable public final class Avisos {
    public private(set) var toasts: [Toast] = []
    public let linea = LineaEstadoModelo()
    public func toast(_ texto: String, tono: TonoAviso, icono: NombreIcono? = nil,
                      accion: (titulo: String, hacer: @MainActor () -> Void)? = nil, duracion: Duration? = nil)
    public func senal(_ texto: String, tono: TonoAviso, medidor: EstadoSenal? = nil, icono: NombreIcono? = nil, dato: String? = nil)
    //   senal() → línea de estado si se ve el partido y no hay acción; si no, toast (a2 §8)
}
```

Posición (de `Maquetacion`, con tests):

| Caso (ancho < 768) | Borde inferior del toast |
|---|---|
| barra visible, sin mini | `safeB + 94` |
| barra visible y mini | `safeB + 178` |
| sin barra (partido) | `safeB + 12` |
| inmersivo | no se pinta (opacidad 0, sin toques; se anuncia a VoiceOver) |
| ancho ≥ 768 | abajo a la derecha: `safeR + 20`, `safeB + 20`; con mini y ancho 768-919, `safeB + 104`; ancho `min(420, ancho − 40)` |

Entrada `opacity + offset(y: 12) + scale(0,98)` con `estandar`; salida `opacity + offset(y: 6)` con `salida`;
`AccessibilityNotification.Announcement(texto).post()` al crear.

### C.7 Hojas nativas con el contenido de la web (decisión 5)

```swift
public enum Hoja: Identifiable, Sendable {
    case gustos
    case pegar(ContextoPegar)                     // .libre | .partido(id)
    case reportar(hash: String, numero: Int)
    case encontrarCanal(partido: String)
    case guardarFavorito(hash: String, titulo: String, ih: Bool?)
    case renombrar(coleccion: LibraryCollection, hash: String, titulo: String)
    case ayuda                                    // «Atajos de teclado» → en táctil, «Gestos»
    case otroServidor(PairingLink)
    public var id: String { get }
    public var detenciones: Set<PresentationDetent> { get }   // gustos/ayuda [.large]; encontrar [.medium, .large]; resto [.medium]
}
// Armazon/Hojas.swift — el único `.sheet` de la app (el revisor lo comprueba)
struct HostHojas: ViewModifier {
    func body(content: Content) -> some View {
        content.sheet(item: $nav.hoja, onDismiss: alCerrar) { hoja in
            ContenidoHoja(hoja: hoja)
                .presentationDetents(hoja.detenciones)
                .presentationDragIndicator(.visible)
                .modifier(FondoHojaOpaco())            // solo con cristalOpaco: .presentationBackground(Palco.glassSolid)
        }
    }
}
```

- Contenido: cabecera propia (título 22/800/125, ✕ «Cerrar»), descripción, cuerpo y botonera de la web.
  El teclado y el arrastre son los del sistema.
- Háptica: `media` al cerrar arrastrando (a1 §8.1): `onDismiss` sabe si se cerró por acción (bandera
  `cerradaPorAccion` que ponen los botones) y solo vibra si no.
- En horizontal, la del sistema (en iPhone a lo ancho con su margen); no se imita el diálogo de 560.

### C.8 Menús nativos con el contenido de la web (decisión 5)

Una sola fuente de verdad por sitio, que alimenta el `Menu`, el `.contextMenu` **y** las acciones de
VoiceOver (a3 §6.5.1, a4 §5.7):

```swift
public struct AccionMenu: Identifiable {
    public let id: String
    public var titulo: String
    public var icono: NombreIcono?
    public var destructiva: Bool = false
    public var habilitada: Bool = true
    public var marcada: Bool = false          // «Datos técnicos ✓», lista activa
    public var grupo: Int = 0                 // cambiar de grupo = separador (Section)
    public var ejecutar: @MainActor () -> Void
}
struct ContenidoMenu: View {                  // Section por grupo; Button(role: .destructive) · Label { Text } icon: { Image(uiImage: IconoUIKit.imagen(…)) }
    let acciones: [AccionMenu]
}
extension View {
    /// Pulsación larga del sistema (vibra sola) con vista previa + las mismas acciones para VoiceOver.
    public func menuContextual<P: View>(_ acciones: @escaping @MainActor () -> [AccionMenu],
                                        @ViewBuilder vistaPrevia: @escaping () -> P) -> some View
}
// «Más opciones» (⋯), «Cambiar de lista»: Menu { ContenidoMenu(acciones: …) } label: { Icono(.more) }
```

Menús de la web y sus funciones puras (todas en `Core/Reglas`, con vectores del orden y los textos):
`opcionesPartido(match:…)` (a3 §6.5), `opcionesReproductor(…)` (14 de a4 §5.6), `opcionesFuente(…)`
(a4 §12.6), `opcionesCanal(…)` (a5 §3.9), `opcionesDispositivo(…)` (a6 §8.9 / §8.10.2).

Regla crítica (§H riesgo 7): **ninguna vista previa contiene `VistaVideo`** (un hueco nuevo en la ventana
arrastraría la única capa de vídeo a la vista previa). La del vídeo usa la tarjeta del canal/partido.

### C.9 Transiciones: pestañas, zoom al teatro y volver desde el borde

- Pestañas: §C.3.
- **Tarjeta → teatro (zoom de elemento compartido, decisión 3)**: `CapaPartido` es una capa del `ZStack`
  raíz (no `NavigationStack`). Al abrir, la vista de origen publica su marco global
  (`onGeometryChange(for: CGRect.self) { $0.frame(in: .global) }`) en `TransicionZoom.origen`; la capa
  entra con un `Transition` propio:

```swift
struct TransicionZoom: Transition {          // protocolo Transition de iOS 17
    let origen: CGRect?; let destino: CGRect
    func body(content: Content, phase: TransitionPhase) -> some View
    // identity: nada · willAppear/didDisappear: scaleEffect(origen/destino, anchor: .topLeading) + offset + clipShape(radio 14→0) + opacity
    // sin origen conocido → el fundido ±16 de la web
}
```

  Animación `Movimiento.heroe` al entrar y `estandar` al salir. La **única** capa de vídeo no se mueve:
  el hueco del teatro entra en la ventana y `SuperficieVideo` recoloca la capa (mini → teatro).
- **Volver desde el borde izquierdo** (decisión 3): `BordeAtras` (`UIGestureRecognizerRepresentable` con
  `UIScreenEdgePanGestureRecognizer`, a2 §27.4), activo solo con la capa del partido en vertical, sin
  hoja ni menú; la capa sigue al dedo (`offset(x:)`), la pestaña de debajo con `offset(x: −16·(1−p))`;
  suelta con `Volver.decide(dx:vx:ancho:)` [L] (`dx ≥ 0,35·ancho` o `vx ≥ 450` y `dx ≥ 24`); háptica
  `ligera`; `.accessibilityAction(.escape)`.

#### C.9.3 Por qué no `navigationTransition(.zoom)`

Solo existe sobre `NavigationStack` o presentaciones: obligaría a meter las pestañas vivas en una pila del
sistema (barra de navegación de iOS 26 que hay que esconder, efectos de borde de scroll), su gesto de
cerrar arrastrando **no se puede apagar en inmersivo** (la web no minimiza en inmersivo), vuelve a la
tarjeta en vez de encogerse al mini y no deja probar el progreso con funciones puras. El zoom propio usa
APIs de iOS 17 que ya compilan en este proyecto.

### C.10 Horizontal (maquetación ≥ 768 de la web)

- `Maquetacion.tipo == .tableta` → barra superior, cabeceras de 44, mini en tarjeta de 440 abajo a la
  izquierda, toasts a la derecha, carteles de 300, versus `xl` con nombres 30.
- Partido + horizontal + alto ≤ 540 → **inmersivo**: vídeo a pantalla completa (`.ignoresSafeArea()` solo
  en el fondo negro), controles con relleno `max(12, safe)`, variante «tableta» (cápsula del canal,
  Detener, directo largo) salvo el SE (667 < 768: variante móvil, a4 §18.1),
  `.statusBarHidden(true)`, `.persistentSystemOverlays(.hidden)`, sin toasts.
- ⛶ y doble toque: `Orientacion.pedir(.landscapeRight)` / `.portrait` con
  `UIWindowScene.requestGeometryUpdate(.iOS(interfaceOrientations:))` + la vuelta segura de a2 §27.8.
- Se corrigen los fallos de la web (decisión 9): el contenido respeta `safeL` en horizontal; menús y hojas
  del sistema respetan las zonas seguras.

### C.11 Tema, transparencia y zonas seguras

- Claves de la web (`aceneo-tema`, `aceneo-transparencia`, `aceneo-pb`) y migración desde la 0.8.0
  (`MigracionClaves`, a1 §13.10), probada con `UserDefaults(suiteName:)` temporal.
- `cristalOpaco` = interruptor propio **o** `accessibilityReduceTransparency` (en la raíz, al entorno).
- Zonas seguras: el contenido nunca ignora el área segura; solo los fondos (`.background { … .ignoresSafeArea() }`).
  El héroe de la agenda va a sangre bajo la barra de estado con fila de chips a `safeT + 76` (a3 §4.7).

---

## D) Reproductor

### D.1 Una sola `AVPlayerLayer`

Se queda `SuperficieVideo` (capa única que va al hueco de más prioridad en ventana). Huecos:

| Dónde | `VistaVideo(prioridad:)` | Notas |
|---|---|---|
| Teatro vertical e inmersivo | `.grande` | el mismo hueco; cambia solo el marco |
| Portada/tarjeta integrada (si una vista integra vídeo) | `.integrado` | reservado |
| Mini (96×54) | `.mini` | |
| Vista previa de un menú | **ninguno** | regla §C.8 |

Con `-AceNeoDemo` el hueco pinta `ImagenDemo` (el campo dibujado de la web) en vez de la capa: así las
capturas coinciden con las de la web.

### D.2 Qué se toca del núcleo (lista cerrada, a8 §3.11)

1. `Endpoint`/`APIClient`: plazo total por carrera `withThrowingTaskGroup` (petición ∥ `Task.sleep`), caché
   `.reloadRevalidatingCacheData` en GET y `.reloadIgnoringLocalCacheData` en el resto, reintento con la
   otra dirección **solo en GET**; `CancellationError` nunca se enseña.
2. `Rutas` + `PlazosWeb.generado`: plazos de la web; `resolver` 20/30 s; + `health`, `settingsUpdate`,
   `pairingCreate(baseUrl:alternateBaseUrls:)`, `devicesList`, `deviceRevoke`.
3. `APIError`: textos de red/plazo/formato de la web (a7 §3.3).
4. `SSEClient`: esperas `EsperaSSE`, `Last-Event-ID` al volver de segundo plano (el estado lo guarda `TiempoReal`).
5. `IdentidadVisor` → `Identidad.visor`: `v_` + 14 base64url por proceso.
6. `ControlesSistema`: título = canal ‖ «Ace Player Neo»; artista = subtítulo ‖ «Ace Player Neo»; álbum
   «Ace Player Neo»; carátula = marca oscura; `stopCommand`, `skipBackwardCommand [30]`; `nowPlayingInfo = nil`
   en idle/error.
7. `MotorAVPlayer`: primer fotograma = `isReadyForDisplay && timeControlStatus == .playing && avance ≥ 0,05`
   (el motor recibe `listoParaPintar: @MainActor () -> Bool` que lee la capa de `SuperficieVideo`; sin KVO).
8. `Reproductor`: textos de a8 §3.11.8; modo en `aceneo-pb`; **fuera** `expandido`, `superficiesGrandes`,
   `visibleEnMini`, `vista`, `expandir()`, `minimizar()`, `superficieGrande(visible:)` (van a
   `PresentacionReproductor`); `puedeDeshacerDetencion` se queda (lo usa el toast).
9. `SesionFuentes` (ex `CentroPartidoModelo`):

```swift
@MainActor public protocol EntornoSesionFuentes: AnyObject {
    var api: APIClient { get }
    var reproductor: Reproductor { get }
    var avisos: Avisos { get }
    var haptica: Haptica { get }
    var reloj: any Reloj { get }
    var tiempoRealAbierto: Bool { get }          // SSE abierto → no sondear el comprobador
}
@MainActor @Observable public final class SesionFuentes {
    public init(partido: FootballMatch, entorno: EntornoSesionFuentes)      // weak internamente, nunca unowned
    // API de hoy + la de session.ts: entrar/salir, rebuscar, elegir, paso(±1), pegar, reportar, confirmar,
    // elegirCandidata(recordar:), vincular(hash:), procesar(_ evento: SSEEvent), textoEspera, failureText
}
```

10. `GestorPiP`, `BotonAirPlay`, `Orientacion`: se quedan. AirPlay en la cápsula de arriba a la derecha
    (☆ · PiP · AirPlay · ⋯) — añadido permitido (decisión 6).

### D.3 Máquina y textos equivalentes a la web

- Conexión: `MaquinaConexion` (port de `machine.ts`, ya probada) y `FaseReproductor.derivar`.
- Presentación: `Core/Reglas/Reproduccion/EstadoVisible.swift` [L], port de `player/status.ts`, sobre una
  instantánea sin tipos de AVFoundation:

```swift
public struct InstantaneaReproductor: Sendable, Equatable {
    public var fase: FaseReproductor; public var mensaje: String?; public var intento: (n: Int, max: Int)?
    public var motivoParada: MotivoParada?; public var textoEspera: String?; public var lead: String?
    public var retraso: Double?; public var enDirecto: Bool; public var hayVentana: Bool; public var arranco: Bool
    public var demo: Bool; public var colchon: (actual: Double, objetivo: Double)?
}
public enum EstadoVisible {
    public static func estadoBase(_ i: InstantaneaReproductor) -> ContenidoLinea          // statusFor (tabla a7 §9.7)
    public static func botonDirecto(_ i: InstantaneaReproductor, anchoVideo: Double) -> BotonDirecto  // liveButton
    public static func mensajeEscenario(_ i: InstantaneaReproductor) -> MensajeEscenario?  // stageMessage (a4 §8.1)
    public static let mensajesReposo: [MotivoReposo: String]                               // IDLE_MESSAGES
    public static func etiquetaMini(_ i: InstantaneaReproductor) -> String                 // «Sonando», «Conectando…»…
}
```

  Vectores desde `status.ts` (mismas entradas → mismas salidas y textos).
- `PresentacionReproductor` (`@MainActor @Observable`): `vista` (.ninguna/.mini/.teatro/.inmersivo),
  `controlesVisibles`, autoocultado 3,2 s **solo** en `reproduciendo` y nunca con VoiceOver
  (a4 §5.7-4), `pantallaCompletaForzada`, `corteANegro` (560 ms), destapados del marcador (se vacían al
  cambiar lo que suena).

### D.4 Sesión de fuentes, reintentos y textos exactos

Port literal de `session.ts` + `model.ts` (a4 §20, a7 §10): arranque automático, salto de entrada, fuente
agotada (automático → siguiente con háptica `aviso`; manual → `error` y nunca salta), rebúsqueda,
reportes con seguimiento (32 consultas / 31 min), «Es el canal correcto», «Encontrar canal». Pruebas:
`SesionFuentesTests` porta los casos de `session.test.ts` con `MotorFalso` y `ServicioFalso` (ya existen) y
`MockURLProtocol`; los textos se comparan con los de los vectores de `model.ts` y `wording.test.ts`.

### D.5 PiP, AirPlay, pantalla de bloqueo y segundo plano

- Lo de hoy (probado): sesión de audio `.playback/.moviePlayback/.longFormVideo`, PiP automático desde la
  capa única, `DelegadoPiP`, `AVRoutePickerView`.
- Segundo plano (a7 §14.2): si **no** suena nada, cortar SSE y sondeos; si suena, mantener latido y (si iOS
  lo deja) el SSE; al volver, reanudar con `Last-Event-ID` y latir ya.

### D.6 Gestos del teatro y del mini (números de la web + mejoras de Isma)

Todo decidido por funciones puras [L] (`Core/Reglas/Gestos`), las vistas solo pasan traslación y velocidad:

| Gesto | Dónde | Regla pura | Umbral | Efecto |
|---|---|---|---|---|
| Toque | vídeo | — | — | alterna controles |
| Doble toque (**nuevo**) | vídeo | — | 2 toques | ⛶ (gira a horizontal inmersivo), háptica `media` |
| Deslizar abajo | vídeo (vertical, no inmersivo) | `Deslizamiento.clasificar` | 56 pt o 450 pt/s con ≥ 24 | minimizar (`atras`), háptica `ligera` |
| Deslizar a los lados (**nuevo**) | vídeo, partido con > 1 fuente visible (o canal con hermanas) | `clasificar` horizontal | 56 / 450 | `SesionFuentes.paso(±1)`, háptica `rigida` |
| Borde izquierdo (**nuevo**) | capa del partido | `Volver.decide` | 0,35·ancho o 450 pt/s | `atras` interactivo |
| Pulsación larga | vídeo | sistema | 0,5 s | `.menuContextual` con «Opciones del reproductor» |
| Deslizar arriba | mini | `GestosMini.soltar` | 72 o rápido | abre el partido, `ligera` |
| Deslizar a un lado | mini | `GestosMini` | cruzar 72 → `fuerte` una vez | sale volando, detiene a 220 ms, toast «Reproducción detenida» + «Deshacer» 6 s |
| Deslizar abajo | mini | `GestosMini.desplazamiento` | frena al 25 % | nada |

El toque simple espera a descartar el doble toque (coste aceptado por la decisión 3). Los gestos
horizontales dentro de `ScrollView` usan `.simultaneousGesture(DragGesture(minimumDistance: 8))` con
bloqueo de eje de la web; si en el iPhone roban el scroll, el plan B es `UIGestureRecognizerRepresentable`
(ya compilado en el canario del borde).

---

## E) Datos

### E.1 Lo que se reutiliza

`APIClient` (bearer, `/native`, 401 → emparejar), `ServerResolver` (carrera LAN/Tailscale), `SSEParser`
(byte a byte), `SSEClient` (lector), modelos `Codable` validados con los fixtures, `DiskCache` y
`CacheImagenes`, `PairingService`, `Llavero`. Cambios: §D.2.

### E.2 Caché de consultas (lo mínimo de TanStack que la web usa)

Concreta y sin borrado de tipos (menos riesgo de compilación que un almacén genérico por clave):

```swift
public struct PoliticaConsulta: Sendable {
    public var frescuraSinSSE: Duration = .seconds(30)     // con SSE abierto: ∞ (solo invalidan los eventos)
    public var frescuraFija: Duration? = nil               // agenda: 10 min
    public var reintentos = 2                              // 1 s y 2 s, solo si `retryable`
    public var alVolverAPrimerPlano = true                 // solo sin SSE (agenda: siempre)
    public var siempreAlMontar = false                     // playback, devices, health, diagnostics
}
@MainActor @Observable public final class Consulta<Valor: Sendable> {
    public private(set) var datos: Valor?
    public private(set) var error: APIError?
    public private(set) var cargando = false
    public private(set) var actualizadaEn: Date?
    public init(_ politica: PoliticaConsulta, pedir: @escaping @Sendable () async throws -> Valor)
    public func asegurar(tiempoRealAbierto: Bool) async   // pide si no hay datos o están caducados
    public func refrescar() async                           // «Actualizar», «Reintentar»
    public func invalidar()                                 // la próxima `asegurar` pide
    public func escribir(_ v: Valor)                        // setQueryData (tras mutaciones y eventos)
}

@MainActor @Observable public final class DatosApp {
    public let arranque: Consulta<BootstrapResponse>
    public let agenda: Consulta<FootballSchedule>
    public let biblioteca: Consulta<LibraryView>
    public let preferencias: Consulta<PreferencesResponse>
    public let ajustes: Consulta<SettingsResponse>
    public let motor: Consulta<EngineStatus>
    public let reproduccion: Consulta<PlaybackStatus>
    public let directorios: Consulta<DirectoryView>
    public let dispositivos: Consulta<DevicesListResponse>
    public let salud: Consulta<HealthResponse>
    public private(set) var marcadores: [String: LiveScore] = [:]          // sondeo propio (§E.5)
    public private(set) var diagnosticos: [String: Consulta<DiagnosticsListResponse>] = [:]   // por causa
    public private(set) var precalentados: [String: Consulta<PreheatResponse>] = [:]         // por partido
    public let senales: SenalPartidos                                        // scan.progress por matchId, 20 min
    public init(api: APIClient, reloj: any Reloj)
    public func invalidar(_ rutas: Set<RutaConsulta>)
    public func invalidarTodo()                                              // resync / versión nueva
    public func aplicar(_ efectos: [EfectoEvento])
    public func sembrar(con arranque: BootstrapResponse)                     // biblioteca, gustos, playback, motor
}
```

`ConsultaTests` con `MockURLProtocol` y un reloj falso: frescura con y sin SSE, reintentos 1 s/2 s solo si
`retryable`, sin reintentos en mutaciones, cancelación silenciosa, `siempreAlMontar`.

### E.3 SSE → efectos (tabla de a7 §6.3-6.4 como función pura)

```swift
public enum RutaConsulta: String, CaseIterable, Sendable {
    case bootstrap, libraryGet, preferencesGet, directoriesGet, settingsGet, playbackStatus, engineStatus
    case footballResolve, footballScan, health, diagnosticsList, devicesList }
public enum EfectoEvento: Equatable, Sendable {
    case invalidar(Set<RutaConsulta>), invalidarTodo
    case escribirMotor(EngineStatus), escribirNowPlaying(NowPlaying?, aprendidos: Int), escribirSesiones([SessionSummary])
    case escaneo(jobId: String), senalPartido(ScanProgressData), veredicto(ScanVerdictData)
    case dispositivos(DevicesChangedData)              // + «revocado» propio → SesionApp (a9 §3.5)
    case paraReproductor(SSEEvent)                     // handoff, stream.*, engine online
}
public enum EfectosEvento { public static func de(_ e: SSEEvent) -> [EfectoEvento] }   // [L], con tests tabla a tabla
```

### E.4 Tiempo real

```swift
public enum EstadoTiempoReal: String, Sendable { case inactivo, conectando, abierto, respaldo, demo }
public enum EsperaSSE { public static func espera(intento: Int) -> Duration }   // [L] 3·2^min(n−1,5), tope 60
@MainActor @Observable public final class TiempoReal {
    public private(set) var estado: EstadoTiempoReal = .inactivo
    public private(set) var ultimoId: String?                  // memoria de proceso (reanudar con Last-Event-ID)
    public init(cliente: SSEClient, datos: DatosApp, al evento: @escaping @MainActor (SSEEvent) -> Void)
    public func arrancar(); public func parar(); public func volvioAPrimerPlano(); public func pasoASegundoPlano(suena: Bool)
    // 10 s sin abrir → respaldo: playback cada 5 s y engine/status cada 20 s (solo .active), nowPlaying sintético
    // al abrir tras un corte: invalida playback y engine/status
}
```

### E.5 Sondeos (atados a lo visible, no a bucles globales)

| Sondeo | Regla pura [L] | Periodo | Vive mientras |
|---|---|---|---|
| Marcadores (agenda/partido) | `ReglasMarcadores.quiere(dia:ahora:)` (15 min antes → 3,5 h después) | 8 s si alguno `in`, 45 s si no | vista visible + `.active` |
| Marcadores (Canales) | `quiereHoy` (minutos ∈ [−210, 15]) | 8/45 s | Canales visible |
| Precalentado por tarjeta | `SenalPartido.enVentana` (−45/+120 min, no terminado, con canales) | 30 s **solo sin SSE** | tarjeta montada y visible |
| Comprobador | — | 1,5 s **solo sin SSE** | sesión de fuentes viva |
| Respaldo playback / motor | — | 5 s / 20 s | `respaldo` + `.active` |
| Dispositivos con código | — | 5 s solo sin SSE | fase `code` + Ajustes visible |
| Reloj compartido | — | 20 s (agenda), 30 s (Canales), 60 s (Ajustes) | con observadores |

Implementación: `.task(id: ClaveSondeo(visible:, …))` en la vista dueña; el cuerpo es un bucle con
`try await Task.sleep(for:)` que la cancelación corta. `SondeosTests` con reloj inyectado.

### E.6 Identidad

`Identidad.visor` (`v_` + 14 base64url, uno por proceso), `Identidad.dispositivo` = `bootstrap.device.id` o el
prefijo del token. Se usa en `channelStream`, latido, soltar, `footballResolve(client:)`, eventos dirigidos
y «Este dispositivo».

### E.7 Capacidades 0.8.1 y versión del servidor

```swift
public struct Capacidades: Sendable, Equatable {        // [L]
    public private(set) var cerradas: Set<RutaAdministracion> = []   // health, settingsUpdate, pairingCreate, devicesList, deviceRevoke
    public mutating func registrar(ruta: RutaAdministracion, error: APIError)   // solo 403 origin_forbidden
    public mutating func olvidar()                                              // versión nueva o servidor nuevo
    public var servidorViejo: Bool { !cerradas.isEmpty }
}
```

`VersionServidor` (a7 §5.2): base = `bootstrap.version`; `ping` tras `resync`, tras reabrir el SSE o tras
≥ 30 min en segundo plano; si cambia: olvidar capacidades, invalidar todo, toast «Tu Umbrel tiene ahora Ace
Player Neo X.»; nunca toca la reproducción.

### E.8 Bajas con «Deshacer»

`BajasPendientes` (6 s con `Task.sleep` cancelable, una por fila, se mandan en `.background` con
`beginBackgroundTask`), mutaciones optimistas de renombrar y favorito sobre `DatosApp.biblioteca.escribir`.

### E.9 Reglas puras portadas con tests espejo (vectores)

Mecanismo (ya probado con `VectoresDominioTests`): `scripts/generar-vectores.ts` importa el TypeScript
**real** con `tsx`, lo ejecuta con una batería de entradas (casos de sus `*.test.ts` + casos límite) y
escribe entradas y salidas; el test Swift exige lo mismo. Funciones con «ahora» reciben el instante como
parámetro.

| Fichero Swift [L] | Web (fuente) | Tests web que se reflejan | Vector |
|---|---|---|---|
| `Agenda/DominioAgenda.swift` | `features/agenda/domain.ts` | `domain.test.ts` | `agenda-domain.json` |
| `Agenda/TarjetasAgenda.swift` | `features/agenda/cards.ts` | `cards.test.ts` | `agenda-cards.json` |
| `Agenda/Destapado.swift` | `features/agenda/score-reveal.ts` | `score-reveal.test.ts` | `score-reveal.json` |
| `Color/ColorOKLab.swift`, `Color/Equipos.swift` | `lib/color.ts`, `lib/teams.ts` | `color.test.ts`, `teams.test.ts` | `color.json`, `teams.json` |
| `Player/Fuentes/ReglasFuentes.swift` | `features/sources/model.ts` | `model.test.ts` | `sources-model.json` |
| `Biblioteca/*` | `library/model.ts`, `on-air.ts`, `player/zapping.ts` | `model.test.ts`, `on-air.test.ts` | `library-*.json` |
| `Buscar/ModeloBuscar.swift` | `search/model.ts` | (SearchView.test) | `search.json` |
| `Listas/ModeloListas.swift` | `directories/model.ts` | — | `directories.json` |
| `Gustos/ModeloGustos.swift` | `preferences/model.ts` | `model.test.ts` | `preferences.json` |
| `Donde/ModeloDonde.swift` | `where-playing/model.ts` | `model.test.ts` | `where-playing.json` |
| `Salud/ModeloSalud.swift` | `health/model.ts`, `api/hooks.ts summarizeEngine` | `model.test.ts`, `hooks.test.ts` | `health.json` |
| `Dispositivos/ModeloDispositivos.swift` | `devices/model.ts` | `model.test.ts` | `devices.json` |
| `Avisos/*` | `notices/toasts.ts`, `statusLine.ts` | `notices.test.tsx`, `wording.test.ts` | `notices.json`, `wording.json` |
| `Reproduccion/EstadoVisible.swift` | `player/status.ts` | `status.test.ts` | `status.json` |
| `Gestos/Deslizamiento.swift` | `lib/gestures.ts` (`classifySwipe`) | `gestures.test.tsx` | `gestures.json` |
| `Maquetacion/Maquetacion.swift` | `lib/media.ts` + fórmulas CSS de a2 | — (tablas de a2/a1) | `media.json` (a mano desde las tablas) |
| `Navegacion/Destino.swift` | `app/routes.ts` | `routes.test.ts` | `routes.json` |
| `Dominio/Hash.swift` | `packages/shared/src/domain/hash.ts` | `channels.test.ts`, `t088-matrix` | `hash.json` |
| `Formatos/*` | `Intl` es-ES de la web (fechas, números) | — | `formatos.json` (salidas de `Intl` en Node) |

Detalles de port que el vector vigila (a7 §14.2): NFD + quitar U+0300–U+036F (no `folding`), FNV-1a con
`UInt32 &*`, reloj de Madrid, «sept»/«jue» con tablas propias, coma decimal es-ES.

---

## F) Servidor simulado = los datos de `?demo=1`

### F.1 Decisión

- **`ServidorSimulado` se sustituye** por `ServidorDemo`: un `URLProtocol` (mismo mecanismo probado) cuyo
  núcleo `RutasDemo.responder(_:estado:ahora:)` es **Foundation puro** [L] y calca `api/demo/index.ts` y los
  manejadores de cada feature.
- Los **datos estáticos** (biblioteca, preferencias, ajustes, dispositivos, motor, playback, directorios,
  diagnósticos base, catálogo del buscador, clubes y competiciones) **no se copian a mano**: los escribe
  `generar-demo.ts` en `Resources/Demo/Demo-*.json` desde el código de la web.
- Los **algoritmos dinámicos** (ancla de 5 min y agenda, marcadores por minuto, precalentado, `demoHash`,
  planes de resolución, comprobador por pasos de 1 350 ms, reportes, vínculos, buscador, salud con «hace N
  min», pairing y QR de adorno) se **portan** a `Debug/DemoNucleo` y se comprueban contra **golden**
  generados por la web con el reloj fijo (`DemoGoldenTests`, en Linux y en la CI de iOS).

### F.2 Cómo se generan (`scripts/generar-demo.ts`, con `tsx`)

```ts
// 1) calzos: localStorage en memoria; Date con reloj fijo que avanza solo cuando el script lo dice
const T0 = Date.parse('2026-09-24T19:00:00+02:00');   // hora recomendada (a7 §5.1)
let desplazamiento = 0;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [T0 + desplazamiento])) }
  static now() { return T0 + desplazamiento } };
// 2) importar el demo REAL de la web (api/demo/index.ts + registerXxxDemo de agenda, sources, search, health, devices)
// 3) resetDemoState(); setDemoAnchor(T0); resetDemoJobs()
// 4) escribir Resources/Demo/Demo-<nombre>.json (estáticos) y Tests/AceNeoTests/Demo/golden/<ruta>@<t>.json:
//    football@0, scores@0/+30min/+60min, preheat/<id>@0, resolve/<id>@0 (demo-1,2,3,4,5,12,6,13, research),
//    scans/<id>@0,+1350,+2700,+5400,+10800 ms, search?q=… (dazn, deportes, laliga, vacío), health@0,
//    diagnostics?cause=*@0, pairing@0 (con código fijado), library tras favorite-upsert/history-upsert/rename/delete
// 5) --check: regenera en memoria y compara byte a byte
```

- Las `id` de trabajo del comprobador y el código de emparejar usan `Date.now()`/aleatorio en la web: el
  script fija el contador y el generador aleatorio (calzo de `Math.random` con semilla) y la Swift recibe
  los mismos valores por parámetro (el golden anota qué semilla).
- `DemoGoldenTests` carga cada golden, llama a `RutasDemo` con el mismo estado y `ahora`, y compara con el
  `ComparadorJSON` de `Ayudas.swift` (orden de claves y números normalizados).

### F.3 Argumentos de lanzamiento (Debug)

| Argumento | Qué hace |
|---|---|
| `-AceNeoServidorSimulado` | `ServidorDemo` sin marcas de demo y con **SSE simulado** (flujos de UITests) |
| `-AceNeoEmparejado` | arranca emparejada (`dev_iphone01`, «iPhone de prueba», token de 43 `A`) |
| `-AceNeoDemo` | implica los dos anteriores + modo demo: tiempo real `demo` (sin SSE), esperas de 120/260 ms, todas las marcas de demo de a7 §5.1, `ImagenDemo` en el reproductor |
| `-AceNeoReloj <ISO>` | reloj de pared que **arranca** en esa hora y avanza (`RelojDesplazado`); los plazos siguen con `ContinuousClock` |
| `-AceNeoHistorialCapturas` | precarga el historial del recorrido de capturas (HOY «DAZN 1», «DAZN»; ESTA SEMANA «Canal de prueba») |
| `-AceNeoServidor080` | las 5 rutas de administración responden 403 `origin_forbidden` (modo degradado) |
| `-AceNeoVista <vista>` | abre directamente una vista (`Destino(vista:)`), sin animación |
| `-aceneo-tema claro|oscuro` | tema (el dominio de argumentos pisa `@AppStorage`); `-AceNeoApariencia` queda como alias |
| `-AceNeoEmpezarDeCero` | E2E contra el backend real (se queda) |

`Reloj`:

```swift
public protocol Reloj: Sendable { var ahora: Date { get } }                 // [L]
public struct RelojSistema: Reloj { public var ahora: Date { Date() } }
public struct RelojDesplazado: Reloj {                                     // inicio + (ContinuousClock.now − arranque)
    public init(inicio: Date, arranque: ContinuousClock.Instant = .now)
    public var ahora: Date { get }
}
```

### F.4 UITests: flujos

`FlujosUITests` (con `-AceNeoServidorSimulado -AceNeoEmparejado`): emparejar por enlace
(`app.open(URL("aceneo://pair?u=…&c=482913"))`), abrir partido `demo-1` → arranca la fuente 1 → minimizar
arrastrando → mini → deslizar a un lado → «Deshacer» → borde izquierdo → pestaña activa sube arriba →
hoja «Reportar fuente» → menú contextual de la tarjeta → gustos → tirar para actualizar. Identificadores =
los `data-testid` de la web cuando existen; si no, los de a2 §22.9 y a8 §6.3 con el mismo esquema
(`pestana-*`, `tarjeta-partido-<id>`, `cartel-fuente-<n>`, `mini-reproductor`, `video-teatro`,
`toast-accion`…). `sePinta` sigue vigilando lo que XCUITest da por visible sin pintarse.

### F.5 Capturas lado a lado con la web

- Simulador **iPhone 16e (390×844 pt)** si el runner lo tiene; si no, se crea con
  `simctl create "iPhone 16e" com.apple.CoreSimulator.SimDeviceType.iPhone-16e <runtime>`; el iPhone 17
  Pro queda para el resto.
- `CapturasWebUITests`: para cada vista de `final/` (agenda, partido, reproductor, mini-reproductor,
  biblioteca-favoritos/recientes/listas/vacia/sonando, buscar, buscar-enlace, pegar, preferencias, ajustes,
  ajustes-apariencia/reproduccion/donde/motor, dispositivos, salud, ayuda, sistema) × {claro, oscuro} ×
  {vertical, horizontal}: lanza con `-AceNeoDemo -AceNeoReloj 2026-09-24T19:00:00+02:00 -AceNeoVista
  <vista> -aceneo-tema <tema>` (+ `-AceNeoHistorialCapturas` en las de biblioteca), gira con
  `XCUIDevice.shared.orientation = .landscapeLeft` para 844×390, espera a la marca de datos listos
  (`identifier == "vista-lista"`) y 1,2 s, y guarda el adjunto `<vista>-390x844-<tema>.png` /
  `<vista>-844x390-<tema>.png` (`lifetime = .keepAlways`). Los estados de a8 §8.4 van como
  `<vista>-<estado>-…` con sus pasos.
- `comparar-capturas.py` (en la CI, **informativo**, no bloquea): reduce las del simulador a 1× con el mismo
  filtro, las pone junto a las de la web y marca diferencias; las zonas seguras (la web a 0) hacen que el
  píxel a píxel nunca sea exacto: sirve para ver saltos grandes, no para aprobar.
- Dependencia fuera de iOS (no se toca aquí): `apps/web/scripts/revision-visual.mjs` necesita `--reloj`
  (a7 §5.1), `--escala 3` y los estados que faltan (a8 §8.4) para que las referencias usen la misma hora.

---

## G) Plan de implementación paralelizable

### G.1 Olas

| Ola | Quién | Qué | Sale cuando |
|---|---|---|---|
| **0 · Cimientos** (1 agente, orquestador) | `project.yml`/`Info.plist`/xcconfig (0.8.1), `Package.swift` espejo, `revisar-swift.mjs`, generadores (tokens, iconos, plazos, fuentes) y sus salidas, **canarios** (§G.3), **contratos** (§G.2) con stubs que compilan, cambios de CI (§G.4) | CI `compilar` verde en Debug y Release; job Linux verde; lista de APIs confirmadas escrita en §G.3 |
| **1 · Poda** (1 agente) | Borrar `Design/`, `Features/**` de interfaz, `RootView`, `ReproductorVistas`; partir `AppModel` en `SesionApp`/`DatosApp`/`Navegador`/`PresentacionReproductor`; `CentroPartidoModelo` → `SesionFuentes`; mover a `Core/Reglas` lo que usan `FixturesTests`, `CacheYFormatoTests`, `ReglasFuentesTests` y `SesionFuentes` (p. ej. `FormatoAgenda.equipos` → `DominioAgenda.titulo`); borrar/rehacer los tests que dependen de lo borrado; UITests reducidos a un humo | CI `unitarios` verde con la app mostrando el armazón vacío (stubs) |
| **2 · Construcción** (6-8 agentes en paralelo) | A1…A8 de §G.2 | cada agente: revisor + Linux en local; CI `compilar` por lotes |
| **3 · Integración** | orquestador + A8 | flujos completos, capturas, horizontal, E2E real, IPA | CI `completo` verde + IPA |
| **4 · Pulido en el iPhone** | Isma + orquestador | vidrio, alto de línea, gestos en el aparato, `vidrioEnListas` | lista de pruebas de `docs/pruebas-iphone.md` |

### G.2 Agentes, carpetas exclusivas y contratos

| Agente | Carpeta exclusiva | Consume (contratos congelados) | Entrega |
|---|---|---|---|
| **A1 Sistema** | `Sources/Palco/**`, `Tests/AceNeoTests/Palco/**` | — | tokens, `Mona`, `EstiloTexto`, `Num`, iconos, cristal, sombras, movimiento, háptica, las 25 primitivas, galería |
| **A2 Armazón** | `Sources/Armazon/**`, `Sources/App/RaizView…`, `Tests/…/App/**` | `Destino`, `Maquetacion`, `Hoja`, `AccionMenu`, primitivas (stubs) | raíz, `AppShell`, barras, velo, avisos, hojas, menús, capa del partido, zoom, borde, orientación, tema |
| **A3 Datos** | `Sources/Core/Datos/**`, `Sources/Core/Networking/**`, `Sources/App/SesionApp.swift`, `Tests/…/Datos/**` | `Reloj`, modelos | `Consulta`, `DatosApp`, `TiempoReal`, efectos, sondeos, identidad, capacidades, versión, bajas, plazos/errores, rutas 0.8.1 |
| **A4 Reglas** | `Sources/Core/Reglas/**`, `Sources/Core/Dominio/**`, `scripts/generar-vectores.ts`, `Tests/…/Reglas/**`, `Tests/…/Vectores/**` | — (puro) | todos los ports de §E.9 con vectores (todo [L]) |
| **A5 Reproductor** | `Sources/Player/**`, `Sources/Armazon/PresentacionReproductor.swift`, `Tests/…/Reproductor*` | `EstadoVisible` (A4), `Avisos`/`Haptica` (firmas) | cambios del núcleo, `SesionFuentes`, PiP/AirPlay/bloqueo, primer fotograma |
| **A6 Agenda + Partido** | `Sources/Pantallas/Agenda/**`, `Sources/Pantallas/Partido/**` | todo lo anterior por firma | agenda, héroe, tarjetas, gustos, teatro, controles, fuentes, inspector, mini |
| **A7 Canales · Buscar · Ajustes · Emparejar** | `Sources/Pantallas/{Canales,Buscar,Pegar,Hojas,Ajustes,Emparejar}/**`, `Sources/Core/Emparejar/**` | idem | biblioteca, buscar, pegar, hojas, 10 secciones de Ajustes, QR nativo, emparejar |
| **A8 Demo + UITests + CI** | `Sources/Debug/**`, `Resources/Demo/**`, `scripts/generar-demo.ts`, `Tests/AceNeoUITests/**`, `Tests/…/Demo/**`, `.github/workflows/ios.yml` (tras la ola 0) | `Reloj`, rutas, modelos | servidor demo con golden, SSE demo, flujos, capturas, comparación |

Si hace falta dividir más: A7 en «Canales/Buscar/Pegar» y «Ajustes/Emparejar».

**Contratos de la ola 0** (ficheros que crea el orquestador, con cuerpos mínimos que compilan; los
dueños rellenan sin cambiar firmas):

1. `Core/Reglas/Navegacion/Destino.swift` (`Pestana`, `PestanaBiblioteca`, `SeccionAjustes`, `Destino`, `Sentido`).
2. `Core/Reglas/Maquetacion/Maquetacion.swift` (`Margenes`, `Maquetacion` con todas sus propiedades).
3. `Core/Reglas/Avisos/ColaToasts.swift` (`Toast`, `TonoAviso`, `ContenidoLinea`, `EstadoSenal`).
4. `Core/Reglas/Reproduccion/EstadoVisible.swift` (`InstantaneaReproductor`, `BotonDirecto`, `MensajeEscenario`).
5. `Core/Datos/Reloj.swift`, `Core/Datos/RutaConsulta.swift`, `Core/Datos/EfectosEvento.swift` (tipos).
6. `Armazon/Navegador.swift`, `Armazon/Avisos.swift`, `Armazon/Hojas.swift` (`Hoja`), `Armazon/Menus.swift` (`AccionMenu`, `.menuContextual`).
7. `Palco/**`: tokens e iconos **generados de verdad** + stubs de `Mona`, `EstiloTexto`, `.estilo`, `.cristal`, `Icono`, `Num`, `Haptica` y las 25 primitivas (cada una pinta un `Text` o un rectángulo).
8. `App/SesionApp.swift`, `Core/Datos/DatosApp.swift`, `Armazon/PresentacionReproductor.swift` (propiedades y métodos, cuerpos vacíos).
9. `Pantallas/*/…View.swift` vacías (`Text("Agenda")`…) para que el armazón compile desde el principio.

Cambiar un contrato = un commit del orquestador que actualiza la firma y a todos sus usuarios a la vez.

### G.3 Canarios de API (ola 0, `Sources/Sonda/`, un fichero por API; se borran al cerrar la ola)

| Canario | Qué comprueba | Si falla |
|---|---|---|
| `SondaVidrio.swift` | `glassEffect(_:in:)`, `Glass.regular/.clear/.tint(_:)/.interactive()`, `GlassEffectContainer(spacing:)`, `glassEffectID(_:in:)` | material + tinte en `CristalPalco` (una función) |
| `SondaBordeScroll.swift` | `scrollEdgeEffectHidden(_:for:)` / `scrollEdgeEffectStyle(_:for:)` | no se toca el efecto de borde |
| `SondaAltoLinea.swift` | modificador de alto de línea de `Text` en el SDK 26.5 | `.altoDeLinea` de una línea + diferencia aceptada |
| `SondaGeometria.swift` | firmas exactas de `onGeometryChange(for:of:action:)` y `onScrollGeometryChange(for:of:action:)` con Swift 6 (aislamiento de los cierres) | ajustar la plantilla de §C.2 |
| `SondaScroll.swift` | `ScrollPosition(edge:)`, `.scrollPosition($:)`, `scrollTo(edge:)`, `.scrollTargetBehavior(.viewAligned)`, `.refreshable` | — (iOS 17-18, muy probable) |
| `SondaGestos.swift` | `UIGestureRecognizerRepresentable` con `UIScreenEdgePanGestureRecognizer` y `UILongPressGestureRecognizer`, `CoordinateSpaceConverter` | `DragGesture` en la franja de 20 pt |
| `SondaMenus.swift` | `.contextMenu(menuItems:preview:)`, `Menu` con `Section` y `Button(role:)`, `Label` con `Image(uiImage:)`, `.accessibilityActions {}` | — |
| `SondaHojas.swift` | `.sheet(item:onDismiss:)` + `presentationDetents`, `presentationDragIndicator`, `presentationBackground` | — |
| `SondaHaptica.swift` | `.sensoryFeedback(_:trigger:)` y `(_:trigger:condition:)` con tipos explícitos | — |
| `SondaTexto.swift` | `.contentTransition(.numericText(value:))`, `rotation3DEffect(_:axis:anchor:anchorZ:perspective:)`, `Font(CTFont)`, `CTFontCopyVariation` | — |
| `SondaTransicion.swift` | protocolo `Transition` propio + `.transition(_:)` | fundido ±16 sin zoom |
| `SondaSistema.swift` | `requestGeometryUpdate(.iOS(interfaceOrientations:))` con su cierre de error, `.persistentSystemOverlays`, `.statusBarHidden`, `ImageRenderer.uiImage`, `AccessibilityNotification.Announcement` | — |
| `SondaEntorno.swift` | `@Entry` en `EnvironmentValues`, `@Observable` genérico `@MainActor` (el de `Consulta<V>`) | `Consulta` con subclases concretas |

Cada canario es una vista o función sin usar (el enlazador la quita). Un solo run de `compilar` lista
**todos** los que fallan (el compilador sigue con los demás ficheros).

### G.4 Ciclo con la CI (sin Xcode)

Cambios en `.github/workflows/ios.yml`:

```yaml
on:
  workflow_dispatch:
    inputs:
      modo:
        type: choice
        options: [compilar, unitarios, completo, ipa-sin-tests]
        default: completo
      ipa_aunque_fallen_tests: { type: boolean, default: false }
      simulador: { type: string, default: 'iPhone 16e' }
jobs:
  nucleo-linux:                          # ~3 min, sin macOS
    runs-on: ubuntu-latest
    container: swift:6.2
    steps: [checkout, node 24 + pnpm install,
            revisar-swift --check, generar-* --check (catálogo, vectores, tokens, iconos, plazos, demo),
            "swift build --package-path ace-player-neo/apps/ios", "swift test --package-path ace-player-neo/apps/ios"]
  ios:
    needs: nucleo-linux
    steps:
      # compilar: build-for-testing Debug (simulador) + build Release generic/platform=iOS sin firma
      #   | tee build/compilar.log ; fallar si hay «took Nms to type-check» (avisos de -warn-long-*)
      # unitarios: test-without-building -only-testing:AceNeoTests (SIN reintentos)
      # completo: + -only-testing:AceNeoUITests con -retry-tests-on-failure -test-iterations 2, pila E2E, capturas, comparación, IPA
      # ipa-sin-tests: compilar + archive + IPA
```

Tiempos esperados: `compilar` 6-8 min (Debug + Release), `unitarios` 12-15 min, `completo` 25-35 min.

Rutina por lote (orquestador): `node scripts/revisar-swift.mjs` → `docker run --rm -v "$PWD":/w -w /w/ace-player-neo/apps/ios swift:6.2 swift test` → commit → `gh workflow run ios.yml -f modo=compilar` → si verde y el lote toca comportamiento, `modo=unitarios`; `completo` solo al cerrar una ola.

### G.5 Patrones prohibidos o vigilados (`revisar-swift.mjs`)

| Regla | Origen |
|---|---|
| Ninguna cadena cruda `#"…"#` en `Sources/` (JSON y colores van en ficheros o en código normal) | rotura de `1a3f24c` (`#"{"primary":"#1d3f9a"}"#`) |
| `var body` de más de 40 líneas o cadenas de más de 12 modificadores → partir en subvistas / `@ViewBuilder` con nombre; ternarios anidados en argumentos de modificadores; colores o medidas calculados dentro de un modificador (usar `let` intermedios) | `b838f53` (type-checker) + `-warn-long-*` como fallo en la CI |
| `.sensoryFeedback(` solo en `Palco/Haptica` y siempre con tipos explícitos | `b838f53` |
| `GeometryReader` prohibido (salvo el fichero de medidas si hiciera falta); `.ignoresSafeArea` solo dentro de `.background {}` o del fondo negro del inmersivo | `455264f` |
| `TabView`, `tabViewBottomAccessory`, `NavigationStack`, `NavigationSplitView` prohibidos | `e944e51` y §C.9.3 |
| `.sheet(` solo en `Armazon/Hojas.swift`; `.contextMenu(` solo en `Armazon/Menus.swift` | una sola puerta: menos casos raros |
| `#available`, `#if compiler`, `@available(iOS`, `PreviewProvider`, `#Preview` | mínimo iOS 26; sin Xcode las vistas previas solo suman código |
| `.font(.body`/`.headline`/…, `Font.custom(`, `@ScaledMetric`, `.monospacedDigit()`, `.fontWeight(`, `.bold()` | tipografía de a1 §3.7 |
| `.foregroundColor(`, `.cornerRadius(`, `onChange(of:perform:)`, `UIScreen.main`, `AsyncImage` | obsoletos (avisos) o fuera del diseño |
| `nonisolated(unsafe)` sobre constantes `Sendable`; `unowned` | avisos de hoy / cuelgues en tests |
| `DispatchQueue`, `Timer.scheduledTimer`, `ObservableObject`, `@Published`, `@StateObject` | concurrencia moderna uniforme |
| En `Core/Reglas`, `Core/Models`, `Core/Dominio`, `Debug/DemoNucleo`: solo `import Foundation` (y `FoundationNetworking` con `#if canImport`) | paquete Linux |
| Identificadores de accesibilidad: formato `^[a-z0-9-]+$` | UITests |
| Un `View` por fichero en `Pantallas/` salvo subvistas privadas de < 30 líneas | reparto y type-checker |

### G.6 Plantillas seguras (las copian los agentes)

```swift
// 1) Vista con estado observable: cuerpo corto y piezas con nombre
struct TarjetaPartido: View {
    let partido: FootballMatch
    @Environment(DatosApp.self) private var datos
    @Environment(\.accessibilityReduceMotion) private var reducido
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { versus; progreso; linea }
            .menuContextual({ acciones }) { vistaPrevia }
    }
    @ViewBuilder private var versus: some View { … }
    private var acciones: [AccionMenu] { OpcionesPartido.acciones(partido, …) }
}

// 2) Tarea atada a la visibilidad (pestañas vivas)
.task(id: visible) {
    guard visible else { return }
    while !Task.isCancelled {
        await datos.refrescarMarcadores(dia: dia)
        try? await Task.sleep(for: ReglasMarcadores.intervalo(datos.marcadores))
    }
}

// 3) Cierres que cruzan a la interfaz: siempre @MainActor y sin capturar la View en tareas largas
Button("Reportar y comprobar") { Task { @MainActor in await sesion.reportar(hash, motivo: motivo) } }
```

---

## H) Riesgos principales y mitigación

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| 1 | **Errores de compilación de interfaz que solo ve la CI** (20-30 min por vuelta) | alta | alto | R2 Linux para todo lo puro; R5 revisor en Windows; stubs de la ola 0 (las pantallas compilan contra firmas reales desde el día 1); `modo=compilar` de 6-8 min; lotes pequeños; nunca dos olas sin verde |
| 2 | **Una API de iOS 26 no existe o tiene otra firma** (`glassEffect`, borde de scroll, alto de línea, representables de gestos) | media | alto | canarios de la ola 0 (§G.3) con alternativa escrita para cada uno |
| 3 | **Type-checker** («unable to type-check… in reasonable time») | media | medio | reglas de §G.5 + `-warn-long-*` convertidos en fallo en la CI desde el primer lote |
| 4 | **Swift 6 concurrencia** en la interfaz (cierres de hojas/menús, delegados UIKit, `static let` que llaman a `@MainActor`) | media | medio | R1 (misma configuración que hoy), `Mona` no aislado, `@MainActor` explícito en todo modelo `@Observable`, plantillas §G.6, delegados con conformidad `@MainActor` probados en el canario |
| 5 | **Romper lo que ya funciona del núcleo** al quitar la interfaz | media | alto | ola 1 separada y hecha por un solo agente; `unitarios` verde antes de la ola 2; los ~150 tests del núcleo se conservan; cambios del núcleo solo los de a8 §3.11, cada uno con su test |
| 6 | **Liquid Glass**: aspecto distinto al de la web y coste de rendimiento con muchos vidrios en listas | media | medio | vidrio solo donde la web tiene cristal; `GlassEffectContainer` por grupo; `CristalPalco.vidrioEnListas` como interruptor; tintes en una función; ajuste en la ola 4 con capturas |
| 7 | **La capa única de vídeo** salta a una vista previa del menú contextual o a una hoja | media | alto | regla «ninguna vista previa con `VistaVideo`» (revisor: `VistaVideo(` solo en `Pantallas/Partido/EscenarioVideo.swift` y `MiniReproductor.swift`); `SuperficieUnicaTests` se conservan |
| 8 | **Gestos en conflicto** (borde vs deslizar el vídeo vs «Emitiendo» vs scroll; pulsación larga del sistema vs arrastres; doble toque retrasa el toque) | alta | medio | decisiones en funciones puras con tests; prioridades explícitas; plan B con `UIGestureRecognizerRepresentable`; prueba en el iPhone en la ola 4 |
| 9 | **Tipografía**: fuente no registrada (sale la del sistema en silencio) o sin ejes (peso 200); alto de línea de CoreText ≠ CSS | media | alto | `FuenteMonaTests` (PostScript + `CTFontCopyVariation` + `UIFont(name:)` no nulo); `.altoDeLinea`; capturas |
| 10 | **Deriva web ↔ app** (tokens, iconos, reglas, demo, plazos, errores cambian en la web) | media | medio | todo generado con `--check` en el job Linux: la CI falla al primer cambio |
| 11 | **Horas y formatos** (Madrid vs dispositivo, «sept», coma decimal) | media | medio | tablas propias + vectores con salidas de `Intl` en Node |
| 12 | **SSE en segundo plano** y reanudación | media | medio | `TiempoRealTests` (esperas, respaldo a 10 s, `Last-Event-ID`, `resync`), prueba en el iPhone |
| 13 | **Servidor 0.8.0** con la app 0.8.1 | alta al principio | bajo | `Capacidades` + `-AceNeoServidor080` en los UITests; el servidor sale a la vez (a9 §8) |
| 14 | **Hojas y menús nativos** no se parecen a los de la web | segura | bajo | aceptado por Isma (decisión 5); el contenido es el de la web |
| 15 | **Capturas no comparables** (tamaño del simulador, zonas seguras, reloj, datos) | alta | bajo | iPhone 16e, `-AceNeoReloj` en los dos lados, mismos datos por golden, comparación informativa |
| 16 | **Solo en Release** falla (optimización `wholemodule`, `#if DEBUG`) | baja | alto | `compilar` incluye Release para dispositivo en cada vuelta |
| 17 | **Choques entre agentes** | media | medio | carpetas exclusivas, contratos congelados, cambios de contrato solo por el orquestador, un commit por agente y lote |
| 18 | **Claves de la 0.8.0** (tema, modo) se pierden al actualizar | baja | bajo | `MigracionClaves` con test |
| 19 | **Barra de estado** sobre el héroe oscuro en tema claro (la web la deja blanca) | media | bajo | primera entrega automática; `UIHostingController` propio solo si Isma lo pide (a3 §17-2) |
| 20 | **Minutos de macOS y colas** | media | bajo | job Linux como filtro previo; `completo` solo al cerrar olas; `concurrency` cancela vueltas viejas |

---

## Anexo 1 · Qué se usa y qué no

| Se usa (iOS 17-26) | No se usa (y por qué) |
|---|---|
| `@Observable`, `@Entry`, `ScrollPosition`, `onScrollGeometryChange`, `onGeometryChange`, `scrollTargetBehavior`, `contentMargins`, `sensoryFeedback`, `contentTransition(.numericText)`, `Transition`, `phaseAnimator`/`TimelineView`, `Animation.spring(duration:bounce:)`, `.snappy`/`.bouncy`, `glassEffect`/`GlassEffectContainer` (tras canario), `.sheet` + `presentationDetents`, `Menu`, `.contextMenu(menuItems:preview:)`, `.accessibilityActions`, `.refreshable`, `UIGestureRecognizerRepresentable`, `ImageRenderer`, `requestGeometryUpdate` | `TabView` y su barra (decisión 4, `e944e51`), `NavigationStack` (§C.9.3), `navigationTransition(.zoom)` (§C.9.3), `GeometryReader` + `ignoresSafeArea` (`455264f`), SF Symbols en la interfaz (otra forma), `Picker(.segmented)`, `Toggle` del sistema, `List`/`Form` (márgenes del sistema), `AsyncImage`, `.monospacedDigit()`, `Font.custom`, `#Preview`, «Approachable Concurrency» y aislamiento por defecto (R1), `Observations`/observación de AVFoundation de iOS 26 (el sondeo actual funciona), accesos rápidos del icono (fuera de alcance) |

## Anexo 2 · Orden de commits de la ola 0 (cada uno compila por sí solo)

1. `build(ios): mínimo iOS 26, solo iPhone, 0.8.1, fuentes Mona/Martian, ENABLE_PREVIEWS NO` (sin tocar Swift).
2. `build(ios): paquete espejo SwiftPM del núcleo puro + job Linux` (añade `#if canImport(FoundationNetworking)` a los ficheros de red).
3. `chore(ios): revisar-swift y generadores de tokens, iconos y plazos con --check`.
4. `test(ios): canarios de API de iOS 26` → `modo=compilar` → se anota el resultado en §G.3 → se borran.
5. `feat(ios): contratos y stubs del armazón, Palco y pantallas` → `modo=compilar` verde.
6. (Ola 1) `refactor(ios): fuera la interfaz 0.8.0; AppModel partido; SesionFuentes` → `modo=unitarios` verde.
