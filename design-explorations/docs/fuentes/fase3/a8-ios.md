# Fase 3 · A8 · Inventario de la app de iPhone actual: qué se reutiliza y qué se tira

> Fuente para la app nativa nueva «web móvil calcada» (SwiftUI, iOS 26 como mínimo, Xcode 26.6 / SDK iOS 26.5).
> Leído el 25-sep-2026 sobre la rama `rediseno/palco` (último commit de iOS `455264f`), el workflow
> `.github/workflows/ios.yml` (con un cambio **sin commitear** en el árbol de trabajo, ver §8.1) y las
> ejecuciones de la CI de los días 23 y 25 de septiembre (`gh run view`). Solo lectura: no se ha tocado nada del repo.
>
> Rutas relativas a `ace-player-neo/apps/ios/` salvo que se diga otra cosa.

---

## 0. Resumen

1. La app actual (0.8.0 «Palco», ~18 000 líneas de Swift) tiene **un núcleo invisible sólido** (red, emparejamiento, SSE, modelos, caché, reproductor AVPlayer con PiP/AirPlay/pantalla de bloqueo, servidor y motor simulados) que **no tiene ni un solo `#available`** y pasa sus ~150 tests unitarios en la CI: se reutiliza como base, **pero no «tal cual»**: plazos de red, reconexión y respaldo del SSE, sondeos de marcadores/sesiones/señal, avisos, identidad del visor, pantalla de bloqueo, detección del primer fotograma y varios mensajes siguen al prototipo y no a la web. La lista cerrada de lo que hay que cambiar está en **§3.11**.
2. **Toda la interfaz se tira**: `Sources/Features/**/*View.swift`, `Sources/Design/**` (componentes SwiftUI), `Sources/Player/ReproductorVistas.swift`, `Sources/App/RootView.swift`, más los colorsets «Palco» del prototipo (la web usa otros valores y otro algoritmo de colores). Los colores nuevos van **en código** como `UIColor` dinámico con los hex sRGB de a1 (§7.5); en el catálogo solo queda `Bg` para la pantalla de arranque.
3. Hay **reglas puras escondidas en ficheros de interfaz o del prototipo** que NO son las de la web: colores de la tarjeta versus (RGB lineal frente a ΔE OKLab de `lib/teams.ts`), cápsula de señal (prototipo `SignalCapsule` frente a `features/agenda/cards.ts`), umbrales de gestos (mini: 36/44 pt frente a `DISMISS_PX = 72` de `MiniPlayer.tsx`). Esas se **reescriben portando la web** y se validan con vectores generados desde TypeScript (el mecanismo ya existe: `scripts/generar-vectores.mjs`).
4. `AppModel` mezcla estado de servidor (reutilizable) con estado de presentación (escenario, pestaña pedida): se parte en dos.
5. `Reproductor` también guarda estado de presentación (`expandido`, `superficiesGrandes`, `visibleEnMini`, `vista`): se saca a un modelo de presentación de la interfaz nueva.
6. Tests: se quedan los del núcleo (APIClient, Endpoint, SSE, Llavero, emparejar, fixtures, máquina, reproductor, PiP, capa única, sistema, caché, catálogo, vectores, Info.plist); se reescriben los de reglas de Palco y de gestos, y **todos los UITests** (identificadores nuevos), conservando sus ayudas y el E2E contra el backend de verdad.
7. CI: 21–30 min por ejecución (compilar 4–8 min, tests 11–17 min, IPA 2–3 min). Hay un modo `solo_compilar` a medio hacer (sin commitear) y la opción `ipa_aunque_fallen_tests`. La última ejecución completa (0.8.0) dejó 193 tests en verde y 7 UITests en rojo (todos del mini/escenario, ya corregidos en `455264f`, en curso).
8. **Huecos del servidor para calcar la web**: desde `/native` están prohibidas `GET/DELETE devices`, `GET health`, `GET health/live`, `POST pairing` y `PUT settings` (`origin_forbidden`). Las pantallas web **Dispositivos, Salud, Sistema** y cualquier cambio de ajustes del servidor no se pueden hacer en el iPhone sin tocar `packages/shared/src/routes.ts`. Es una decisión de Isma (seguridad).
9. **El QR solo lleva una dirección** (`aceneo://pair?u=<una URL>&c=<código>`): con «solo QR para sincronizar», el cambio automático casa/Tailscale necesita que el servidor meta la segunda dirección en el enlace (p. ej. `&t=`) o que la app la descubra después.
10. Aprendizajes de compilación que hay que respetar desde el primer commit: `##"…"##` para JSON con `"#hex"`, cuerpos de `View` cortos y tipos explícitos en `sensoryFeedback`, no leer `safeAreaInsets` de un `GeometryReader` con `.ignoresSafeArea()`, y `tabViewBottomAccessory(isEnabled:)` solo desde iOS 26.1 (irrelevante: el calco NO usa `TabView`, ver §12.2).
11. **iPad sin decidir** (§13): la app actual es universal (`TARGETED_DEVICE_FAMILY "1,2"`). Recomendación: **solo iPhone** en la primera IPA (lo que pidió Isma); si se mantiene el iPad, §13 describe las maquetaciones «tableta» (768–1023), «escritorio» (1024–1279) y «ancha» (≥ 1280) que la web usa y que ningún otro documento cubre.
12. **Icono y nombre** (§7.3–§7.4): el icono oscuro del iPhone es **el mismo dibujo** que `apps/web/public/icon.svg` (fichero idéntico), pero el iPhone usa por defecto una variante **clara** que la web no tiene, y el nombre visible es «Ace Neo» mientras la marca de la barra dice «Ace Player Neo». Hay que decidirlo.
13. **Faltan capturas de referencia** de estados que hay que calcar (toast con «Deshacer», menús abiertos, hojas, vacíos, claro en 844×390, 375×667 y 375×812): lista y forma de sacarlas en §8.4.

---

## 1. Estado actual

| Dato | Valor |
|---|---|
| Nombre / bundle id | «Ace Neo» / `es.ismaeloul.aceplayerneo` (`Config/AceNeo.xcconfig`, sobrescribible con `ACE_BUNDLE_ID=`) |
| Versión | `MARKETING_VERSION = 0.8.0`, `CURRENT_PROJECT_VERSION` = número de ejecución de la CI |
| Mínimo actual | iOS 17.0 (`project.yml`: `deploymentTarget.iOS` e `IPHONEOS_DEPLOYMENT_TARGET`) |
| Lenguaje | Swift 6.0 (`SWIFT_VERSION: "6.0"`), `SWIFT_STRICT_CONCURRENCY: complete` |
| Dependencias externas | **Ninguna** (ni SwiftPM ni CocoaPods) |
| Compilador en la CI | Xcode 26.6 (build 17F113), SDK iOS 26.5, simulador «iPhone 17 Pro» iOS 26.5 (23F77) |
| Tamaño de la IPA sin firmar | 3,4 MB (0.7.0) |
| Tests | 187 funciones de test unitarias + 13 de interfaz = 200 |
| Última ejecución completa | `36099058452` (25-sep 05:33): 193 ✔, 7 ✘ (UITests del mini/escenario: «Minimizar no cierra el escenario», «No aparece el mini-reproductor», «Al minimizar sale el mini»…). Causa corregida en `455264f` (cabecera bajo la barra de estado); ejecución `36101535659` en curso al escribir esto |
| Última en verde | `35914319876` (23-sep, 0.7.1): 165/165 ✔, 21 min |

Líneas de Swift por carpeta:

| Carpeta | Líneas | Veredicto global |
|---|---:|---|
| `Sources/App` | 1 036 | Mixto: `Entorno`/`ModoEjecucion` se quedan; `AppModel` se parte; `RootView` se tira; `AceNeoApp` se reescribe (20 líneas) |
| `Sources/Core/Auth` | 331 | Se queda |
| `Sources/Core/Cache` | 186 | Se queda |
| `Sources/Core/Dominio` | 417 | Se queda (port validado con vectores de la web) |
| `Sources/Core/Models` | 1 708 | Se queda |
| `Sources/Core/Networking` | 1 007 | Se queda |
| `Sources/Player` | 3 050 | Se queda salvo `ReproductorVistas.swift` (645, interfaz) y los umbrales de `GestosReproductor.swift` (130) |
| `Sources/Features` | 6 402 | Se tira la interfaz; se rescatan ~1 800 líneas de reglas/modelos (ver §3.9) |
| `Sources/Design` | 1 974 | Se tira; se rescatan `Aviso`/`Avisos`, `Apariencia`, `EquipoEscudo.monograma`, `FormaEscudo` si la web la usa |
| `Sources/Debug` | 647 | Se queda (se amplía con los datos que pinta la web) |
| `Tests/AceNeoTests` | 3 501 | ~75 % se queda |
| `Tests/AceNeoUITests` | 1 091 | Ayudas y E2E se quedan; los flujos se reescriben |

---

## 2. Clasificación fichero a fichero

Leyenda: **N** = núcleo invisible reutilizable (tal cual o con modernización) · **R** = regla pura reutilizable **solo tras revalidarla contra la web** (o reescribirla portando el TS) · **I** = interfaz a borrar · **D** = depuración/pruebas (se queda) · **C** = configuración/recursos.

### 2.1 `Sources/`

| Fichero | Líneas | Clase | Qué es | Qué hacer |
|---|---:|---|---|---|
| `App/AceNeoApp.swift` | 48 | I/N | `@main`, sesión de audio `.playback` al arrancar, `@AppStorage` de apariencia, `scenePhase` → `volvioAPrimerPlano`/`pasoASegundoPlano` | Reescribir (conservar la sesión de audio, el `scenePhase` y `ModoEjecucion.testsUnitarios` → `Color.clear`) |
| `App/Entorno.swift` | 108 | N | Contenedor de dependencias (`APIClient`, `ServerResolver`, `TokenStore`, `SSEClient`, `DiskCache`, `CacheImagenes`, `ServerConfigStore`, `accesoPerdido`) + `ModoEjecucion` (argumentos de lanzamiento) | Tal cual |
| `App/AppModel.swift` | 713 | N+I | Estado global `@MainActor @Observable`: fase (emparejar/lista), conexión, motor, biblioteca, preferencias, agenda, sesiones, marcadores, goles, centros de partido, PiP, avisos… y el **escenario** | Partir: `SesionApp` (núcleo) + `Presentacion` (interfaz). Ver §3.2. **Cambiar** `vigilarMarcadores`, `vigilarSesiones`, `precalentar` y la vuelta de segundo plano (§3.11.2–§3.11.3) |
| `App/RootView.swift` | 167 | I | `RootView` (emparejar/app, `onOpenURL`, diálogo «¿Emparejar con otro servidor?»), `PrincipalView` (`TabView` + `tabViewBottomAccessory`) | Borrar (copiar la lógica de `onOpenURL` + diálogo, §3.3.4) |
| `Core/Auth/Emparejamiento.swift` | 32 | N | `PairingService.emparejar(config:codigo:nombre:)` | Tal cual |
| `Core/Auth/Llavero.swift` | 148 | N | `TokenStore`, `KeychainBackend`, `SystemKeychain`, `KeychainTokenStore`, `MemoryTokenStore` | Tal cual |
| `Core/Auth/Servidores.swift` | 151 | N | `ServerVia`, `IPv4`, `ActiveServer`, `ServerConfig` (+`normalizar`), `ServerConfigStore`, `PairingLink` | Tal cual; ampliar `PairingLink` si el QR trae 2 direcciones (§10.2) |
| `Core/Cache/CacheImagenes.swift` | 115 | N | `MemoriaImagenes` (NSCache) + `actor CacheImagenes` (memoria/disco/red, peticiones unidas) | Tal cual (+`byPreparingForDisplay`) |
| `Core/Cache/DiskCache.swift` | 71 | N | `actor DiskCache` (JSON por clave en `Caches/AceNeo/`, versión 2) | Tal cual |
| `Core/Dominio/Canales.swift` | 149 | N | Port de `packages/shared/src/domain/channels.ts` (`clave`, `puntuacion`, `emite`) | Tal cual (quitar `nonisolated(unsafe)`) |
| `Core/Dominio/ParaTi.swift` | 268 | N | Port de `domain/for-you.ts` (`enParaTi`, `destacado`, claves) | Tal cual |
| `Core/Models/Biblioteca.swift` | 191 | N | `Item`, `LibraryView`, `DirectoryView`, `Preferences*`, `LibraryMutation`, `SearchResult`… | Tal cual |
| `Core/Models/Eventos.swift` | 307 | N | `SSEEvent` (14 tipos) y sus datos, `SSEEnvelope`, `ApiErrorEnvelope` | Tal cual |
| `Core/Models/Futbol.swift` | 537 | N | Agenda, escudos (`TeamBadge`, `CompetitionBadge`), marcadores, resolución, comprobador, precalentado, vínculos, reportes, resultados | Tal cual |
| `Core/Models/Primitivas.swift` | 78 | N | `EnumTolerante`, `FechaISO`, `Date(epochMs:)`, `SinContenido`, `Origin`, `ClientKind` | Tal cual |
| `Core/Models/Reproduccion.swift` | 253 | N | `PlaybackMode` (+`perfilIOS`), `PoliticaReconexion`, `StreamGrant`, latido, release, `SessionSummary`… | Tal cual |
| `Core/Models/Sistema.swift` | 342 | N | `PingResponse`, `BootstrapResponse`, `HealthResponse`, `EngineStatus`, `Settings`, `Device`, emparejamiento, diagnóstico | Tal cual |
| `Core/Networking/APIClient.swift` | 92 | N | Cliente `/native/api/v1` con Bearer, reintento en la otra dirección, 401 → emparejar | Se queda; **plazo total** en vez de inactividad y política de caché/reintentos de la web (§3.11.1) |
| `Core/Networking/APIError.swift` | 120 | N | Errores con mensaje en español + `ErrorCatalog.describir/mensaje` | Se queda; **cambiar** los textos de red y de plazo por los del cliente web (§3.11.1) |
| `Core/Networking/Endpoint.swift` | 118 | N | `Endpoint<R>`, `QueryParam`, `Codificacion` (RFC 3986, `+` → `%2B`) | Tal cual |
| `Core/Networking/ErrorCatalog.swift` | 108 | N (generado) | 87 códigos de `packages/shared/src/errors.ts` | Tal cual (lo regenera `scripts/generar-catalogo-errores.mjs`) |
| `Core/Networking/Rutas.swift` | 168 | N | `enum API`: todas las rutas `any` accesibles desde `/native` | Se queda la lista; **cambiar los plazos** a los de la web (§3.11.1); añadir las que se abran (§10.1) |
| `Core/Networking/SSEClient.swift` | 131 | N | SSE con reconexión exponencial, `Last-Event-ID`, 45 s de inactividad | Se queda el lector; **cambiar** esperas (3·2ⁿ s, tope 60 s), añadir estados y respaldo por sondeo, y reanudar con `Last-Event-ID` (§3.11.2) |
| `Core/Networking/SSEParser.swift` | 118 | N | Lector `text/event-stream` byte a byte | Tal cual |
| `Core/Networking/ServerResolver.swift` | 152 | N | `actor ServerResolver`: carrera de pings LAN/Tailscale | Tal cual |
| `Debug/MotorSimulado.swift` | 81 | D | Motor de vídeo sin red para XCUITest | Tal cual |
| `Debug/ServidorSimulado.swift` | 566 | D | `URLProtocol` que responde como un Ace Player Neo (código `482913`) | Se queda; ampliar datos (Dispositivos, Salud…) y pasar el JSON a ficheros (§9.1) |
| `Design/CapsulaSenal.swift` | 88 | R+I | `ReglasSenal.capsula` (del prototipo) + vista | Reescribir la regla desde `features/agenda/cards.ts` (`signalWord`, `signalTone`); borrar la vista |
| `Design/CartelFuente.swift` | 242 | I | `AnilloCalidad`, `CartelFuente`, `CartelCanal` | Borrar |
| `Design/Componentes.swift` | 579 | I (+N) | `EstadoSenal`, `MedidorSenal`, `AnilloDirecto`, `MarcaEquipo`, `ColorEquipo`, `LogoCanal.dorsal`, `DisposicionFlujo` (Layout), `ChipSeleccionable`, **`Aviso`/`Avisos`**, cristal | `Aviso`/`Avisos` **se reescribe** como port de `notices/*` (máx. 2, 2,8 s, abajo, «×n», línea de estado; §3.11.4); quizá `DisposicionFlujo`; el resto, borrar. `ColorEquipo`/`LogoCanal.dorsal` → reportar desde `lib/color.ts` (`hueFromName`, `channelTone`) |
| `Design/Escudos.swift` | 257 | R+I | `RGB`, `ColoresVersus`, `EquipoEscudo`, `FormaEscudo`, `EscudoGenerado`, `EscudoView` | Reescribir `ColoresVersus` desde `lib/teams.ts` + `lib/color.ts` (algoritmo distinto, §3.9.6); vistas, borrar |
| `Design/EstadosVista.swift` | 71 | I | `EstadoVacio`, `IndicadorMotor` | Borrar |
| `Design/ImagenCacheada.swift` | 36 | I (patrón) | Vista que lee `CacheImagenes.enMemoria` y luego pide | Reescribir igual (el patrón es bueno: nunca `AsyncImage`) |
| `Design/Palco.swift` | 308 | I | `TonoCapsula`, `CapsulaPalco`, `BotonCapsula`, `BotonOro`, `BotonSegundoToque`, `CabeceraFila`, `EntradaEscalonada`, `PuntoDirecto`, `hapticoSeleccion` | Borrar (la lógica de «segundo toque en 5 s» se rehace según la web) |
| `Design/TarjetaVersus.swift` | 203 | I | Tarjeta versus del prototipo | Borrar |
| `Design/Tema.swift` | 190 | I (+N) | `Tinta` (colorsets), `Muelle`, `Medida`, **`Apariencia`**, cristal, fuentes | Rescatar `Apariencia` (mismos tres valores); su clave `es.ismaeloul.aceplayerneo.apariencia` solo se lee una vez para migrar a `aceneo-tema` (a1 §13.10); el resto sale de los tokens de la web |
| `Features/Agenda/AgendaView.swift` | 692 | I | `AgendaView`, `PortadaDestacado`, `TiraDias`, `TarjetaPersonalizar` | Borrar |
| `Features/Agenda/AgendaViewModel.swift` | 307 | N+R | `AgendaViewModel` (caché→red), `RelojMadrid`, `ReglasAgenda`, `FormatoAgenda`, `ModoAgenda`, `EstadoPartido` | Modelo: tal cual. Reglas: revalidar contra `features/agenda/domain.ts` (`madridClock`, `matchStatus`, `dayLabel`, `defaultDay`, `minutesToMatch`) |
| `Features/Agenda/ReglasPalco.swift` | 195 | R | `AntiSpoiler`, `Gol`, `RegistroGoles`, `PartidosPorFase`, `ReglasAgenda.porFase/destacado/precalentables`, `Marcador`, `FormatoAgenda.chipHora` | Revalidar/reescribir desde la web (`match-center/Scoreboard.tsx` `GOAL_MS=1200`, `agenda/cards.ts` `versusWhen`) |
| `Features/Library/CanalesView.swift` | 610 | I (+R) | Vista + `FiltroBiblioteca`, extensión de `Item` | Borrar vista; rescatar el filtro si coincide con la web |
| `Features/Library/ReglasBiblioteca.swift` | 211 | R | `SeccionBiblioteca`, `GrupoCategoria`, `GrupoRecientes`, `ReglasBiblioteca`, `EnAntena`, `IndiceAntena` | Revalidar contra `features/library` / `features/biblioteca` de la web |
| `Features/MatchCenter/CentroPartidoModelo.swift` | 413 | N | Port de `features/sources/session.ts`: resolver, comprobador, arranque automático, política única de cambio de fuente, reportar, pegar, corregir | Se queda (quitar `unowned let app: AppModel`, §3.9.1) |
| `Features/MatchCenter/EscenarioView.swift` | 1 332 | I (+N) | Escenario + `HermanasModelo` (fuentes hermanas de un canal) + `HojaEscenario` + `CapsulaMarcador`, `CajaSinReproduccion`, `DatosTecnicos` | Borrar vistas; rescatar `HermanasModelo` si la web tiene «fuentes hermanas» |
| `Features/MatchCenter/HojasEscenario.swift` | 360 | I | Hojas fuentes/reportar/pegar/dónde se emite | Borrar |
| `Features/Pairing/PairingView.swift` | 291 | I | Pantalla de emparejar + `MarcoEnfoque` | Borrar (la pantalla QR nueva es un añadido a la web; conservar textos útiles, §3.3.4) |
| `Features/Pairing/PairingViewModel.swift` | 94 | N | Direcciones LAN/Tailscale + código de 6 cifras, `aplicar(enlace)`, `leido(texto)`, `emparejar` | Tal cual |
| `Features/Pairing/QRScannerView.swift` | 133 | N | Escáner AVFoundation (`QRScannerController`, `CajaSesion`) | Tal cual (o `DataScannerViewController`, §3.3.5) |
| `Features/Search/BuscarView.swift` | 270 | I (+N) | `BuscarModelo` (búsqueda en el motor con espera de 450 ms) + vista | Rescatar `BuscarModelo` (revisar el retardo contra la web) |
| `Features/Settings/AjustesView.swift` | 344 | I | Ajustes en `Form` | Borrar |
| `Features/Settings/DondeSuenaView.swift` | 230 | R+I | `enum DondeSuena` (este dispositivo, nombre, icono, protocolo, título, orden) + vistas | Rescatar `DondeSuena` (revalidar con `features/where-playing`) |
| `Features/Settings/GustosView.swift` | 321 | R+I | `TipoGusto`, `GustosEditables` (port de `preferences/model.ts`) + vista | Rescatar las reglas |
| `Features/Settings/ListasView.swift` | 169 | I | Listas M3U/HTML | Borrar |
| `Features/Sources/ReglasFuentes.swift` | 430 | N | Port de `features/sources/model.ts` (estado efectivo, cuarentena, resumen, zapeables, hash válido, D6 HEVC) | Se queda |
| `Player/ControlesSistema.swift` | 175 | N | `AVAudioSession`, Now Playing, `MPRemoteCommandCenter` | Se queda la mecánica; **cambiar** título, artista, álbum y carátula, y añadir «detener» y −30 s (§3.11.6) |
| `Player/Directo.swift` | 139 | N | `VentanaDirecto`, `Directo`, `UmbralesReproductor`, `InfoDirecto` | Se queda |
| `Player/GestosReproductor.swift` | 130 | R | `VistaReproductor` + umbrales de gestos del **prototipo** | La forma (funciones puras + tests) se queda; **los números se cambian por los de la web** |
| `Player/MaquinaConexion.swift` | 143 | N | Port de `apps/web/src/player/machine.ts` | Se queda |
| `Player/MotorAVPlayer.swift` | 212 | N | `MotorVideo` con AVPlayer, sondeo sin KVO | Se queda; **cambiar** la detección del primer fotograma (§3.11.7) |
| `Player/MotorVideo.swift` | 58 | N | Protocolo `MotorVideo`, `EstadoTiempo`, `EventoMotor` | Se queda |
| `Player/Reproductor.swift` | 975 | N | Port de `player/runtime.ts` | Se queda; sacar `expandido`/`superficiesGrandes`/`vista` a la presentación; **cambiar** dos mensajes propios y añadir los que faltan (§3.11.8) |
| `Player/ReproductorVistas.swift` | 645 | I | `ControlesVideo`, `VideoApp`, `MarcadorPiP`, `LineaEstado`, `CapaEscenario`, `MiniReproductor`, `MiniAccesorio`, `ReservaMini` | Borrar |
| `Player/ServicioReproduccion.swift` | 163 | N | `CanalReproducible`, `ContextoPartido`, `Concesion`, `ServicioReproduccion` (+API), `IdentidadVisor` | Se queda; **cambiar** `IdentidadVisor` al formato y la vida de la web (§3.11.5) |
| `Player/SuperficieVideo.swift` | 410 | N | Una sola `AVPlayerLayer` (`SuperficieVideo`, `HuecoVideoUIView`, `VistaVideo`), `GestorPiP`, `ControladorPiP`, `DelegadoPiP`, `BotonAirPlay`, `Orientacion` | Se queda |

### 2.2 Configuración, recursos y scripts

| Fichero | Clase | Qué hacer |
|---|---|---|
| `project.yml` | C | Se queda con cambios (§7) |
| `Config/AceNeo.xcconfig` | C | Se queda; subir `MARKETING_VERSION` (¿0.9.0?) |
| `Config/Info.plist` | C | Se queda; añadir `UIAppFonts` (Mona Sans), revisar orientaciones y familia (§7.3) |
| `Resources/Assets.xcassets/AppIcon.appiconset` (claro, oscuro, tintado, 1024) | C | Se queda la variante oscura (mismo dibujo que la web); **decidir** la variante por defecto (§7.4) |
| `Resources/Assets.xcassets/Marca.imageset` (@2x/@3x, claro/oscuro) | C | Pasar a **una sola variante** (la oscura, = `/icon.svg`): la web pinta el mismo icono en los dos temas (barra superior 28×28 y carátula de la pantalla de bloqueo). Ver §7.4 |
| `Resources/Assets.xcassets/Colores/*.colorset` (23) y `AccentColor` | C | **Borrar** salvo `Bg` (lo pide `UILaunchScreen.UIColorName`) y `AccentColor`; los colores de la interfaz van en código (`UIColor` dinámico con los hex sRGB de a1 §2.1/§13.2). Ver §7.5 |
| `scripts/build-ipa.sh` | C | Se queda |
| `scripts/generar-catalogo-errores.mjs` | C | Se queda |
| `scripts/generar-vectores.mjs` | C | Se queda y **se amplía** a las reglas de la web que se porten (teams, color, cards, domain, sources/model, preferences/model, where-playing, library) |
| `scripts/generar-recursos.mjs` | C | Se queda; quitar `PALCO` o ponerlo a los valores de la web; añadir fuentes si se generan |
| `scripts/pila-e2e.mjs` | D | Se queda |
| `README.md`, `../../docs/ios.md`, `../../docs/pruebas-iphone.md` | C | Reescribir la parte de pantallas; conservar ATS, firma, IPA Station, pruebas en el iPhone |

---

## 3. El núcleo reutilizable, pieza a pieza

Para cada pieza: **API pública**, **dependencias**, **fallbacks de iOS 17-25 que sobran con iOS 26** y **Swift 6 / concurrencia**. Hallazgo general: **el núcleo no tiene ningún `#available` ni `#if compiler`** (todos están en la interfaz, §11.1), así que subir el mínimo a iOS 26 no le quita código; solo permite modernizar.

### 3.1 `Entorno` y `ModoEjecucion` (`App/Entorno.swift`)

```swift
public struct Entorno: Sendable {
    public let api: APIClient
    public let servidores: ServerResolver
    public let tokens: any TokenStore
    public let tiempoReal: SSEClient
    public let cache: DiskCache
    public let imagenes: CacheImagenes
    public let configuracion: ServerConfigStore
    public let accesoPerdido: AsyncStream<Void>        // 401 con token → volver a emparejar
    public init(session: URLSession, tokens: any TokenStore, configuracion: ServerConfigStore,
                cache: DiskCache, directorioImagenes: URL? = nil)
    public static func real() -> Entorno                // Llavero + UserDefaults + Caches/AceNeo
    public static func actual() -> Entorno              // real, o ServidorSimulado en Debug con -AceNeoServidorSimulado
}
public enum ModoEjecucion {
    static var testsUnitarios: Bool     // XCTestConfigurationFilePath y NO servidor simulado
    static var servidorSimulado: Bool   // -AceNeoServidorSimulado
    static var empezarDeCero: Bool      // -AceNeoEmpezarDeCero (solo Debug: borra token, direcciones y caché)
    static var aparienciaForzada: String? // -AceNeoApariencia claro|oscuro (solo Debug)
}
```

- `URLSessionConfiguration.default` con `waitsForConnectivity = false`, `httpMaximumConnectionsPerHost = 6`, `URLCache` 4 MB/32 MB y `useProtocolCachePolicy` (ETag/304 de agenda, arranque y escudos).
- Las imágenes llevan el mismo `Authorization: Bearer` (cierre `peticion` de `CacheImagenes`) y `Accept: image/png, image/*`.
- Dependencias: todo el núcleo.
- Fallbacks: ninguno.
- Swift 6: correcto (`struct Sendable`, `AsyncStream.makeStream(bufferingPolicy: .bufferingNewest(1))`).
- Cambios: ninguno obligatorio. Si la web nueva necesita más argumentos de lanzamiento (p. ej. `-AceNeoPantalla agenda` para ir directo a una vista en las capturas), van aquí.

### 3.2 `AppModel` (`App/AppModel.swift`) — se parte en dos

Lo que **se queda en el núcleo** (llamémoslo `SesionApp`, `@MainActor @Observable`):

| Estado | Tipo | Notas |
|---|---|---|
| `fase` | `.emparejar` / `.lista` | Se decide en `init`: hay token y direcciones → `.lista` |
| `conexion` | `.conectando` / `.conectado(ActiveServer)` / `.sinConexion(String)` | Para la píldora «sin conexión» |
| `motor` | `EngineStatus?` | Del arranque y de `engine.status` por SSE |
| `biblioteca` | `LibraryView?` | Primero de caché, luego del arranque |
| `versionServidor`, `dispositivoId` | `String?` | Del arranque |
| `aviso` | `String?` | «Se ha retirado el acceso…» tras 401 |
| `recargas` | `Int` | Sube con `resync` |
| `marcadores`, `goles` | `[String: LiveScore]`, `[String: [Gol]]` | `vigilarMarcadores()` cada 60 s |
| `preferencias`, `agenda` | `Preferences?`, `FootballSchedule?` | |
| `sesiones`, `sesionesCargadas` | `[SessionSummary]`, `Bool` | «Dónde se está reproduciendo» |
| `marcadoresDestapados` | `Set<String>` | Anti-spoiler (se vacía al cambiar de canal) |
| `centrosVersion` + `centros` privados | | Centros de partido vivos: el que suena, el abierto y los precalentados |
| `reproductor`, `pip`, `avisos`, `controles` | | |

Métodos del núcleo: `emparejado()`, `desemparejar()`, `arrancar()`, `refrescarArranque()`, `arrancarTiempoReal()`, `pararTiempoReal()`, `volvioAPrimerPlano()`, `pasoASegundoPlano()`, `restaurarDesdePiP()`, `marcadorTapado(_:)`, `destaparMarcador(_:_:)`, `taparMarcadores()`, `baseServidor`, `urlImagen(_:)` (antepone base + `/native` a `/api/v1/football/teams/…/crest?v=…`), `precalentarEscudos(_:)`, `refrescarSesiones()`, `vigilarSesiones()` (cada 20 s), `tituloConocido(_:)`, `agendaCargada(_:)`, `cargarAgendaGuardada()`, `guardarGustos(_:completar:)`, `cargarPreferencias()`, `centroSonando`, `centro(para:)`, `centroCargado(_:)`, `precalentar(_:)` (hasta 6 partidos), `detenerConDeshacer()` («Deshacer» 6 s), `reproducirCanal(_:lista:)`, `canalesDeBiblioteca(para:)`, `canalReproducible(_:)`, `refrescarMarcadores()`, `vigilarMarcadores()`, `esFavorito(_:)`, `alternarFavorito(id:titulo:ih:)`, `mutar(_:aviso:)`, `aplicarBiblioteca(_:)`, `activarLista(_:)`, `sincronizarLista(url:nombre:tipo:id:)`, `borrarLista(_:)`, `reiniciarMotor()`.

> ⚠ **No es la web**: `vigilarMarcadores()` (cada 60 s, siempre), `vigilarSesiones()` (cada 20 s), `precalentar(_:)` (hasta 6 partidos, creando un centro de partido por cada uno) y la vuelta de segundo plano (SSE sin `Last-Event-ID` + `bootstrap`) no siguen las reglas de la web. Se cambian según §3.11.2–§3.11.3; `detenerConDeshacer()` y los avisos, según §3.11.4.

Lo que **es interfaz** (va a la presentación nueva): `ObjetivoEscenario`, `Pestana`, `escenario`, `escenarioVisible`, `objetivoDeLoQueSuena`, `abrirPartido`, `verPartido`, `abrirCanal`, `reproducirEnlace`, `abrirLoQueSuena`, `cerrarEscenario`, `seguirLoQueSuena`, `pestanaSolicitada`, `pedirPestana`, `empezoElPiP` (minimiza el escenario y pide vertical). La web tiene su propio modelo de navegación (rutas y `stage-slot.ts`/`screen.ts`), así que la presentación nueva se escribe copiando la web, no esta.

Textos literales que hoy salen de aquí (se conservan si la web dice lo mismo): «Reproducción detenida», ««<título>» detenido», «Deshacer», «Quitado de favoritos», «Añadido a favoritos», «Lista guardada», «Lista actualizada», «Lista borrada», «Reiniciando el motor…», «El motor no se ha podido reiniciar ahora», «Enlace pegado».

Otros detalles:
- `vigilarRed()`: `NWPathMonitor` en su propia cola; el primer aviso (estado inicial) no cuenta; los siguientes llaman a `ServerResolver.invalidar()`. Cierre `nonisolated static` con `OSAllocatedUnfairLock` (correcto en Swift 6).
- En segundo plano se corta el SSE (`pararTiempoReal`) y, si suena algo sin PiP, `pip.pasoASegundoPlano()` suelta la capa para que siga el audio.
- `motorPorDefecto()`: `MotorSimulado` en Debug con servidor simulado; si no, `MotorAVPlayer`.
- Swift 6: `@MainActor @Observable final class`; tareas `Task { [weak self] … }`. Correcto.
- Riesgo al partirlo: `CentroPartidoModelo` guarda `unowned let app: AppModel` y le pide `entorno`, `reproductor`, `avisos`: hay que darle un protocolo (§3.9.1).

### 3.3 Emparejamiento, direcciones y QR

#### 3.3.1 `ServerConfig`, `ServerVia`, `ActiveServer`, `ServerConfigStore`, `PairingLink` (`Core/Auth/Servidores.swift`)

```swift
public enum ServerVia: String, Codable, Sendable, CaseIterable { case lan, tailscale
    var etiqueta: String            // «Red local» / «Tailscale»
    static func clasificar(_ url: URL) -> ServerVia   // *.ts.net o 100.64.0.0/10 → tailscale
}
public struct ServerConfig: Codable, Sendable, Hashable {
    var tailscale: URL?; var lan: URL?
    var vacia: Bool
    var candidatas: [ActiveServer]  // primero LAN, luego Tailscale
    static func normalizar(_ texto: String) -> URL?   // añade http://, solo esquema+host+puerto
}
public struct ServerConfigStore: Sendable { init(suite: String? = nil); leer(); guardar(_:); borrar() } // UserDefaults "servidores.v1"
public struct PairingLink: Sendable, Hashable {
    let servidor: URL; let codigo: String
    init?(url: URL)      // aceneo://pair?u=<URL>&c=<6 cifras>
    init?(texto: String)
    static func codigoValido(_:) -> Bool
}
```

- Las direcciones van a `UserDefaults` (no son secretas); el token, solo al Llavero.
- **Limitación importante**: el enlace del QR lleva **una sola** URL (`u`). `PairingViewModel.aplicar` la mete en el hueco LAN o Tailscale según `clasificar`; la otra hay que teclearla. El servidor genera el enlace en `apps/server/src/modules/auth/service.ts` (`aceneo://pair?u=${encodeURIComponent(baseUrl)}&c=${code}`), con `baseUrl` = el que manda la web o el deducido de las cabeceras. Ver §10.2.

#### 3.3.2 Llavero (`Core/Auth/Llavero.swift`)

```swift
public protocol TokenStore: Sendable { func leerToken() throws -> String?; func guardarToken(_:) throws; func borrarToken() throws }
public protocol KeychainBackend: Sendable { anadir, buscar, actualizar, borrar }   // para probar sin Llavero
public struct SystemKeychain: KeychainBackend
public struct KeychainTokenStore: TokenStore   // servicio "es.ismaeloul.aceplayerneo", cuenta "token-dispositivo"
public final class MemoryTokenStore: TokenStore // OSAllocatedUnfairLock; UITests
public enum KeychainError: LocalizedError { case estado(OSStatus), datosIlegibles }
```

- `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: legible con el iPhone bloqueado (latido en segundo plano y PiP), fuera de copias de seguridad.
- Servicio fijo, **no el bundle id**: si IPA Station cambia el bundle id al firmar, el token sigue (con el mismo Apple ID).
- Mensajes: «No se ha podido usar el Llavero del iPhone (error N).», «El token guardado en el Llavero no se puede leer. Vuelve a emparejar la app.»
- Swift 6: correcto. Nada que modernizar.

#### 3.3.3 `PairingService` (`Core/Auth/Emparejamiento.swift`)

`emparejar(config:codigo:nombre:)`: valida `config` no vacía y código de 6 cifras (si no, `APIError.servidor(codigo: "pairing_invalid", estado: 401…)` sin salir a la red) → `servidores.actualizar(config)` → `servidores.resolver()` (carrera de pings) → `POST pairing/claim { code, name ≤ 60, platform: "ios" }` → token al Llavero → direcciones a `UserDefaults`. Nombre por defecto «iPhone».

#### 3.3.4 `PairingViewModel` (`Features/Pairing/PairingViewModel.swift`) y lo rescatable de `PairingView`/`RootView`

- `@MainActor @Observable`; `direccionTailscale`, `direccionLAN`, `codigo` (filtra a 6 cifras ASCII), `estado` (`.editando/.enviando/.error(String)`), `mostrandoEscaner`, `puedeEnviar`, `mensajeError`, `aplicar(_ enlace:)`, `leido(_ texto:) -> Bool`, `emparejar(nombreDispositivo:) async -> Bool`.
- Mensajes: «Ese código QR no es de Ace Player Neo. Sácalo en la web: Ajustes → Dispositivos → Emparejar un dispositivo.», «La dirección de <Red local|Tailscale> no es válida. Ejemplo: http://umbrel.local:7792».
- Textos de la pantalla actual (útiles para la pantalla QR nueva, que la web no tiene): «Ace Player Neo», «Empareja este iPhone», «En la web, abre Ajustes › Dispositivos › Emparejar un dispositivo. Escanea el QR o escribe los seis dígitos y la dirección.», «Escanear el código QR», «o escribe el código», «Código de emparejamiento», marcador `000000`, «Caduca a los 5 minutos y solo sirve una vez.», «Dirección del servidor», «Red local» (`http://umbrel.local:7792`), «Tailscale» (`http://umbrel.tu-red.ts.net:7792`), «Pon una o las dos: la app usa la que responda y cambia sola al salir de casa.», «Emparejar» / «Emparejando…», «Escanear», «Cerrar», «Apunta al código QR que enseña la web.». Identificadores: `boton-escanear`, `campo-codigo`, `campo-lan`, `campo-tailscale`, `boton-emparejar`, `error-emparejar`.
- `RootView.onOpenURL`: si ya está emparejada, diálogo «¿Emparejar con otro servidor?» · «Emparejar de nuevo» (destructivo) · «Cancelar» · mensaje «Se olvidará el servidor actual y se usará el del código.»; si no, rellena el formulario. **Háptico de éxito** al pasar de `.emparejar` a `.lista` (tipos explícitos, §9.2).
- El cambio de fase NO va animado (§9.6).

#### 3.3.5 Escáner QR (`Features/Pairing/QRScannerView.swift`)

- `QRScannerView: UIViewControllerRepresentable(alLeer: @MainActor (String) -> Bool, alFallar: @MainActor (String) -> Void)`; `QRScannerController` con `AVCaptureSession` en una cola propia (`CajaSesion: @unchecked Sendable`), `AVCaptureMetadataOutput` `.qr` con delegado en `.main`, previsualización `resizeAspectFill`, un mismo texto no se procesa dos veces, háptica `UINotificationFeedbackGenerator` éxito/error, para al leer bien.
- Mensajes: «Ace Neo no tiene permiso para usar la cámara. Actívalo en Ajustes → Ace Neo, o teclea el código.», «La cámara no está disponible en este dispositivo. Teclea la dirección y el código.», «No se puede leer códigos QR con esta cámara.»
- Swift 6: `nonisolated func metadataOutput` + `MainActor.assumeIsolated` (válido porque la cola es `.main`). Con Swift 6.2 se puede declarar la conformidad aislada: `extension QRScannerController: @MainActor AVCaptureMetadataOutputObjectsDelegate` (SE-0470) y quitar `assumeIsolated`.
- Alternativa iOS 16+: `VisionKit.DataScannerViewController` (`recognizedDataTypes: [.barcode(symbologies: [.qr])]`) con guía y resaltado del sistema. No funciona en el simulador ni en equipos sin A12; el de AVFoundation es más previsible para calcar un diseño propio. Recomendación: **quedarse con el actual**.
- Pruebas: la cámara no existe en el simulador; los UITests abren el enlace con `XCUIApplication.open(URL)` (lo hace el E2E), que es el camino que hay que seguir probando.

### 3.4 Red

#### 3.4.1 `Endpoint<R>` y `Codificacion` (`Core/Networking/Endpoint.swift`)

```swift
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    static var prefijo: String { "/native/api/v1" }
    let metodo: HTTPMethod; let ruta: String
    var query: [QueryParam]; var cuerpo: Data?; var conToken: Bool; var plazo: TimeInterval; var idempotente: Bool
    init(_ metodo:, _ ruta:, query:, cuerpo:, conToken: Bool = true, plazo: TimeInterval = 15, idempotente: Bool? = nil) // GET = idempotente
    init<Body: Encodable>(_ metodo:, _ ruta:, json: Body, conToken:, plazo:, idempotente: Bool = false) // JSON con .sortedKeys
    func url(base: URL) throws -> URL
    func peticion(base: URL, token: String?) throws -> URLRequest   // Accept/Content-Type JSON, Bearer
}
```

- `Codificacion.segmento/query`: solo `A–Z a–z 0–9 - . _ ~`; nunca `%2F`/`%2E` en la ruta (nginx da 400) y `+` → `%2B` («M+ LaLiga»).

#### 3.4.2 `enum API` (`Core/Networking/Rutas.swift`) — rutas disponibles desde `/native`

| Método | Ruta | Plazo | Token | Idempotente |
|---|---|---:|---|---|
| `ping(plazo:)` | `GET ping` | 4 s | no | sí |
| `bootstrap` | `GET bootstrap` | 15 | sí | sí |
| `eventos(plazoInactividad:)` | `GET events` | 45 (inactividad) | sí | — |
| `estadoMotor` | `GET engine/status` | 15 | sí | sí |
| `reiniciarMotor` | `POST engine/restart` | 30 | sí | no |
| `stream(id:visor:modo:tipo:titulo:)` | `GET channels/:id/stream?client=ios&kind&mode&viewer[&title≤200]` | 60 | sí | **no** |
| `latido(sesion:cuerpo:)` | `POST sessions/:sid/heartbeat` | 10 | sí | no |
| `soltar(sesion:cuerpo:)` | `POST sessions/:sid/release` | 10 | sí | no |
| `estadoReproduccion` | `GET playback` | 15 | sí | sí |
| `ajustes` | `GET settings` | 15 | sí | sí |
| `reclamarCodigo(_:)` | `POST pairing/claim` | 15 | no | no |
| `diagnosticos(causa:desde:limite:)` | `GET diagnostics` | 15 | sí | sí |
| `informarFallo(_:)` | `POST diagnostics` | 15 | sí | no |
| `biblioteca` | `GET library` | 15 | sí | sí |
| `cambiarBiblioteca(_:)` | `POST library` | 15 | sí | no |
| `preferencias` | `GET preferences` | 15 | sí | sí |
| `guardarPreferencias(_:)` | `PUT preferences` | 15 | sí | **sí** |
| `directorios` | `GET directories` | 15 | sí | sí |
| `sincronizarDirectorio(_:)` | `POST directories/sync` | 50 | sí | no |
| `activarDirectorio(id:)` | `POST directories/:id/activate` | 15 | sí | no |
| `borrarDirectorio(id:)` | `DELETE directories/:id` | 15 | sí | no |
| `agenda` | `GET football` | 65 | sí | sí |
| `resolver(partido:canales:rebuscar:actual:actualEsInfohash:cliente:)` | `GET football/resolve` | 30 | sí | **no** |
| `comprobacion(id:)` | `GET football/scans/:id` | 15 | sí | sí |
| `precalentado(partido:)` | `GET football/preheat/:matchId` | 15 | sí | sí |
| `vincular(_:)` | `POST football/bindings` | 15 | sí | no |
| `marcadores` | `GET scores` | 15 | sí | sí |
| `reportarFuente` / `resultadoFuente` / `correccionFuente` | `POST sources/report|outcome|feedback` | 15 | sí | no |
| `buscar(_:)` | `GET search?q=` | 20 | sí | sí |

> ⚠ **Los plazos de esta tabla NO son los de la web** (15/65/20/4/30/10 s frente a 12/14/15/60/50/20… s de `apps/web/src/api/client.ts` `TIMEOUTS`) y además se aplican como plazo de **inactividad** (`URLRequest.timeoutInterval`), no total. Tabla de valores correctos y cambio de mecanismo en §3.11.1.

Escudos y logos no están en `API`: se piden por URL (`AppModel.urlImagen`) a `/native/api/v1/football/teams/:teamId/crest` y `/competitions/:id/logo` (acceso `any`). El vídeo va por `/native/api/v1/video/:sid/:file?t=` (acceso `native`, credencial `video-token`: AVPlayer no puede poner cabeceras).

Rutas **prohibidas desde `/native`** (acceso `web` en `packages/shared/src/routes.ts`): `GET health`, `GET health/live`, `PUT settings`, `POST pairing`, `GET devices`, `DELETE devices/:id`. Sus modelos Swift sí existen (`HealthResponse`, `HealthLiveResponse`, `DevicesListResponse`, `DeviceRevokeResponse`, `PairingCreateResponse`, `SettingsResponse`).

#### 3.4.3 `APIClient` (`Core/Networking/APIClient.swift`)

```swift
public final class APIClient: Sendable {
    let session: URLSession; let servidores: ServerResolver; let tokens: any TokenStore
    init(session:, servidores:, tokens:, alPerderAcceso: @escaping @Sendable () async -> Void = {})
    func enviar<R>(_ endpoint: Endpoint<R>) async throws -> R
}
```

- Token del Llavero en cada petición con `conToken` (si falta o falla el Llavero → `APIError.necesitaEmparejar`, sin tocar la red).
- Fallo de conectividad (`cannotConnectToHost, cannotFindHost, timedOut, networkConnectionLost, notConnectedToInternet, dnsLookupFailed, secureConnectionFailed, internationalRoamingOff, dataNotAllowed, resourceUnavailable`) → `servidores.invalidar()` y, si es idempotente, **un** reintento con la dirección que responda.
- 2xx vacío → `SinContenido`; si no, `JSONDecoder` (un decodificador por petición).
- 401 con token → borra el token, llama a `alPerderAcceso` y lanza `.necesitaEmparejar(codigo:)`. Un 401 sin token (código mal escrito) NO es perder el acceso.
- Swift 6 hoy: correcto. **Riesgo si se activa «Approachable Concurrency»** (Xcode 26, `NonisolatedNonsendingByDefault`): `enviar` pasaría a ejecutarse en el actor de quien llama (el principal) y la decodificación de la agenda (decenas de KB) iría en el hilo principal. Si se activa, marcar `enviar`/`procesar` con `@concurrent`.

#### 3.4.4 `APIError` y `ErrorCatalog` (`APIError.swift`, `ErrorCatalog.swift`)

- Casos: `servidor(codigo:estado:mensaje:requestId:)`, `necesitaEmparejar(codigo:)`, `sinServidor`, `servidorInalcanzable`, `noEsAcePlayerNeo`, `versionIncompatible(Int)`, `red(URLError.Code)`, `formato(String)`, `cancelado`. `desde(_:)` convierte cualquier error.
- `mensaje` (lo que se enseña): el del catálogo común si `isPublic`; si no, el del servidor; si no, `internal_error`. Textos propios: «Todavía no hay ningún servidor configurado. Empareja la app con tu Ace Player Neo.», «No se encuentra el servidor ni por Tailscale ni por la red local. Comprueba que Tailscale está conectado o que estás en casa.», «Esa dirección responde, pero no es un Ace Player Neo. Revisa la dirección y el puerto (normalmente, el 7792).», «El servidor usa la versión N de la API y esta app no la entiende. Actualiza la app o el servidor.», «No hay conexión a internet.», «El servidor ha tardado demasiado en responder.», «iOS no permite conectar con esa dirección sin cifrar. Usa la dirección de Tailscale (.ts.net) o la de la red local.», «No se ha podido conectar con el servidor.», «La respuesta del servidor no tiene el formato esperado. Puede que la app y el servidor tengan versiones distintas.», «Se ha cancelado la operación.»
- `ErrorCatalog.describir` también entiende `http_NNN` (429: «Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.»; resto: «El servidor respondió con un error NNN.»).
- ⚠ Los textos de red y de plazo **no son los de la web** («No hay conexión a internet.», «El servidor ha tardado demasiado en responder.» frente a «No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando.» y «El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.»). Tabla en §3.11.1.
- `ErrorCatalog.swift` es GENERADO (87 códigos); la CI comprueba que está al día.

#### 3.4.5 `ServerResolver` (`Core/Networking/ServerResolver.swift`) — red de casa / Tailscale

```swift
public actor ServerResolver {
    typealias Pinger = @Sendable (URL) async throws -> PingResponse
    init(config: ServerConfig, pinger: @escaping Pinger)
    init(config: ServerConfig, session: URLSession, plazoPing: TimeInterval = 4)
    func configuracion() -> ServerConfig
    func conocido() -> ActiveServer?          // sin ping
    func actualizar(_ nueva: ServerConfig)    // olvida la elegida y cancela la carrera
    func invalidar()                          // la próxima petición vuelve a hacer ping
    func actual() async throws -> ActiveServer
    func resolver() async throws -> ActiveServer   // carrera aunque ya haya elegida
    static func ping(base:session:plazo:) async throws -> PingResponse
}
```

- Ping `GET /native/api/v1/ping` sin token a TODAS las candidatas a la vez (`withThrowingTaskGroup`); gana la primera que responde 200 con `app == "ace-player-neo"` y `apiVersion == 1`. Las peticiones concurrentes comparten la misma carrera; `generacion` descarta resultados de una configuración vieja.
- Mejor explicación de los fallos: versión incompatible > no es Ace Player Neo > ATS > cancelado > inalcanzable.
- Swift 6: correcto (actor, `Task` interna, `Resultado: Sendable`).
- Se re-elige: al fallar por red (`APIClient`, `SSEClient`), al cambiar la red (`NWPathMonitor` en `AppModel`), al reconectar el reproductor (`ServicioReproduccion.olvidarServidor()`).

#### 3.4.6 SSE (`SSEParser.swift`, `SSEClient.swift`)

- `SSEParser` (struct `Sendable`): byte a byte (porque `AsyncBytes.lines` se come las líneas vacías que separan eventos), `\n`/`\r\n`/`\r`, comentarios (`: ping`), `data:` multilínea, BOM, `id` sin NUL, `retry:` numérico. API: `feed(_ byte:) -> SSEMessage?`, `feed(_ bytes:) -> [SSEMessage]`, `feed(_ texto:)`, `lastEventId`, `retryMs`.
- `SSEClient.conectar(desde:) -> AsyncStream<SSEUpdate>` con `SSEUpdate = .conectado(ActiveServer) | .evento(SSEEnvelope) | .desconectado(APIError?, reintentoEn:) | .necesitaEmparejar`. Reconexión 1 s, 2 s, 4 s… hasta 30 s (o `retry:` del servidor si es mayor), `Last-Event-ID`, plazo de inactividad 45 s (el servidor manda `: ping` cada 15 s), 401 → borra token y `.necesitaEmparejar`, fallo de red → `invalidar()`. Un evento mal formado no tumba la conexión.
- Swift 6: correcto (`final class Sendable`, `Task` en el constructor del stream, `onTermination` cancela).
- En segundo plano la app corta el SSE; al volver arranca de nuevo **sin** `Last-Event-ID` (`conectar()` sin argumento) y pide `bootstrap`. ~~Mejora posible~~ **Obligatorio** para calcar la web: guardar el último id y reanudar con él (§3.11.2).
- ⚠ **Esperas y respaldo distintos de la web**: aquí 1, 2, 4… 30 s y ningún respaldo; la web espera `min(60, 3 × 2^min(n−1, 5))` s (3, 6, 12, 24, 48, 60…) y, si en 10 s no abre, **sondea** `playback` cada 5 s y `engine/status` cada 20 s (a7 §6.2). Cambio en §3.11.2.

### 3.5 Modelos Codable (`Core/Models/*`)

- Escritos a mano con los nombres de los esquemas zod; enums tolerantes (`EnumTolerante` → `.desconocido`); fechas ISO como `String` con `FechaISO.parse`; epoch ms como `Int64`.
- Validados por `FixturesTests` contra **todos** los ejemplos de `packages/shared/fixtures` (36 de `v1/`, 15 de `events/`, `errors/`): decodificar, volver a codificar y exigir el mismo JSON; falla si aparece un ejemplo nuevo sin tipo.
- Tipos que la web usa y que la app aún no pinta pero ya decodifica: `HealthResponse`, `Device`, `DevicesListResponse`, `DiagnosticEntry`/`DiagnosticsListResponse`/`DiagnosticCounts`, `ScanJob`, `PreheatResponse`, `ChannelBinding`, `PublicSourceReport`, `SourceStatEntry`, `ChannelFeedback`, `AiInfo`, `ProgramMatch`. Sirven para Salud, Sistema, Dispositivos y los paneles de fuentes de la web.
- Fallbacks: ninguno. Swift 6: todos `Sendable`. Nada que cambiar.

### 3.6 Dominio portado de `@ace/shared` (`Core/Dominio/*`)

- `ParaTi` (for-you.ts): `GustosFutbol`, `PartidoParaTi`, `clavePreferencia`, `claveCompeticion`, `aliasLigas`, `ligaCoincide`, `esHypermotion`, `reglasNacionalidad`, `aliasEquipos`, `claveEquipo`, `equipoCoincide`, `tieneGustos`, `tieneEquipoFavorito`, `enParaTi`, `destacado`.
- `Canales` (channels.ts): `clave`, `puntuacion`, `puntuacionDeClaves`, `emite(titulo:alias:partido:)`, constantes 92/78/58 y palabras de relleno. Límites de palabra como JavaScript (no ICU).
- Validados con `Tests/AceNeoTests/Vectores/vectores-dominio.json` (7 268 líneas) que genera `scripts/generar-vectores.mjs` ejecutando el TypeScript de verdad (Node ≥ 23.6); la CI hace `--check`.
- Swift 6: 6 avisos «`nonisolated(unsafe)` is unnecessary for a constant with 'Sendable' type 'NSRegularExpression'» (líneas 37-43 de `Canales.swift`): en el SDK 26 `NSRegularExpression` es `Sendable`; quitar `nonisolated(unsafe)`.

### 3.7 Cachés (`Core/Cache/*`)

- `actor DiskCache`: `Clave = agenda | biblioteca | arranque | marcadores | preferencias`; `guardar(_:en:fecha:)` (atómico, `completeFileProtectionUntilFirstUserAuthentication`), `leer(_:de:) -> EntradaCache<Valor>?` (descarta si `version != 2`), `borrar(_:)`, `borrarTodo()`. Carpeta `Caches/AceNeo/`.
- `actor CacheImagenes`: `nonisolated let memoria: MemoriaImagenes`, `static clave(_ url:)` (SHA-256 de ruta+query: la misma imagen por LAN y Tailscale), `nonisolated enMemoria(_:) -> UIImage?` (para pintar sin esperar), `imagen(para:) async -> UIImage?` (memoria → disco `Caches/AceNeo/imagenes/<sha>.png` → red, peticiones unidas), `precalentar(_:)`, `peticionesEnCurso`, `borrarTodo()`.
- `MemoriaImagenes: @unchecked Sendable` sobre `NSCache` (límite 24 MB por coste en píxeles×4).
- Mejoras: decodificar fuera y pre-renderizar con `await imagen.byPreparingForDisplay()` (iOS 15) para que el primer pintado no dé tirón; `borrarTodo()` de las dos cachés se pisa (una borra `Caches/AceNeo`, la otra `Caches/AceNeo/imagenes`), inofensivo.

### 3.8 Motor de vídeo y reproducción (`Sources/Player/*`)

#### 3.8.1 `MotorVideo` (protocolo, `@MainActor`)

```swift
public protocol MotorVideo: AnyObject {
    var alEvento: ((EventoMotor) -> Void)? { get set }   // .listo .primerFotograma .estado(EstadoTiempo) .atasco .fallo(String)
    var estadoTiempo: EstadoTiempo { get }               // .pausado .esperando .reproduciendo
    var probableSinCortes: Bool { get }                  // isPlaybackLikelyToKeepUp
    var tiempoActual: Double { get }
    var ventana: VentanaDirecto? { get }                 // seekableTimeRanges
    var colchonPorDelante: Double { get }                // loadedTimeRanges
    var avPlayer: AVPlayer? { get }                      // nil en los falsos
    func cargar(url: URL, perfil: IosPlaybackProfile); func aplicar(perfil:); func reproducir(); func pausar()
    func saltar(a segundos: Double) async -> Bool; func vaciar()
}
```

Implementaciones: `MotorAVPlayer` (app), `MotorSimulado` (UITests, Debug), `MotorFalso` (tests unitarios).

#### 3.8.2 `MotorAVPlayer`

- `AVPlayer` con `automaticallyWaitsToMinimizeStalling = true`, `allowsExternalPlayback = true` (AirPlay de vídeo), `preventsDisplaySleepDuringVideoPlayback = true`.
- Perfil por modo (`IOS_PLAYBACK_PROFILES`): Estable 12 s / Equilibrado 8 s / Baja latencia 4 s en `preferredForwardBufferDuration` y `configuredTimeOffsetFromLive`, con `automaticallyPreservesTimeOffsetFromLive = true`. Cambiar de modo no reconecta.
- **Sin KVO**: sondeo cada 250 ms (500 ms tras el primer fotograma) en el actor principal; «primer fotograma» = el cabezal avanza > 0,2 s reproduciendo. ⚠ La web usa `requestVideoFrameCallback` o, de respaldo, cabezal ≥ 0,05 s; a7 §14.3 pide `isReadyForDisplay` + reproduciendo + 0,05 s. Cambio en §3.11.7. Notificaciones `failedToPlayToEndTime` y `playbackStalled` en `.main` con `MainActor.assumeIsolated`.
- `saltar` usa la versión con cierre de `seek` (la `async` cruzaría el actor con `AVPlayer` no `Sendable`).
- Modernización con iOS 26 (opcional, **verificar en el SDK 26.5** antes de usarlo): AVFoundation publica en iOS 26 observación de Swift para `AVPlayer`/`AVPlayerItem` (activable con `AVPlayer.isObservationEnabled = true`), que permitiría quitar el sondeo; y `NotificationCenter` tiene mensajes tipados (`NotificationCenter.MainActorMessage`). El sondeo actual funciona y está probado con un HLS real en la CI: **no es prioritario**.

#### 3.8.3 `MaquinaConexion` y `FaseReproductor`

Tabla de transiciones idéntica a `apps/web/src/player/machine.ts`: `idle → pidiendo → conectando → (precarga) → arrancando → activa`, `fallo → reconectando → pidiendo`, `agotado → error`, `reenganche → conectando`, `detener/traspaso → idle`. Una transición fuera de tabla se ignora. `FaseReproductor.derivar(conexion, medio)` → `idle, cargando, buffer, reproduciendo, pausado, buscando, reconectando, error` con etiquetas «Detenido», «Conectando», «Cargando», «Reproduciendo», «En pausa», «Saltando», «Reconectando», «Sin señal».

#### 3.8.4 `Directo`

`VentanaDirecto.elegir`, `Directo.rebuild(modo)` (12/8/4), `colchonSeguridad = min(rebuild, max(1,2, ventana×0,25))`, `objetivo(ventana:preferido:seguridad:)`; `UmbralesReproductor` (tic 1,5 s; conexión 36 tics = 54 s; empujón al directo 4 tics = 6 s con ≥ 6 s de retraso o ≥ 2 s descargados o `isPlaybackLikelyToKeepUp`; reconexión por imagen congelada 16 tics = 24 s; gracia 4 tics; avance mínimo 0,2 s; ventana de presupuesto 180 s; «sigue» cada 120 s; retroceso 30 s; tolerancia 1,25 s; mostrar directo 3 s; pausa ajena 0,7 s); `InfoDirecto` con `textoBoton` («Directo» / «−12 s») y `etiquetaAccesible` («En directo, con N segundos de retraso» / «Ir al directo; vas N segundos por detrás»). Comparar con `apps/web/src/player/constants.ts` al hacer la interfaz (la web tiene además `CONTROLS_HIDE_MS = 3200`, `CLICK_DELAY_MS = 190`, `SEEK_TIMEOUT_MS = 2200`, `FROZEN_REBUFFER_TICKS = 3`).

#### 3.8.5 `ServicioReproduccion`

- `CanalReproducible` (`id`, `titulo`, `ih: Bool?`, `partido: ContextoPartido?`, `listaId`, `origen` — `"manual"` no entra en recientes), `tipo: StreamKind` (`infohash`/`id`/`auto`).
- `ContextoPartido` (`id`, `titulo` «Local – Visitante», `competicion`, `canal`).
- Protocolo `ServicioReproduccion: Sendable` (`pedirStream`, `latido`, `soltar`, `resultado`, `informar`, `estadoReproduccion`, `guardarReciente`, `olvidarServidor`) y `ServicioReproduccionAPI` (completa la URL relativa del vídeo con la base que responde).
- `IdentidadVisor.id()` → `ios_<uuid sin guiones>` en `UserDefaults` (`es.ismaeloul.aceplayerneo.visor`), validado con `^[A-Za-z0-9_-]{4,64}$`. ⚠ La web usa `v_` + 14 caracteres base64url **por carga** (solo en memoria) y a7 §7 pide lo mismo por proceso: decisión y cambio en §3.11.5.

#### 3.8.6 `Reproductor` (`@MainActor @Observable`, port de `runtime.ts`)

Estado publicado: `canal`, `conexion`, `medio`, `mensaje`, `intento (n/max)`, `directo: InfoDirecto`, `estadisticas: StreamStatsData?`, `arranco`, `sesionId`, `motivoParada` (`usuario/traspaso/fallo/sinAcceso`), `quiereReproducir`, `modo`, contadores para háptica (`errores`, `cambiosDeFuente`, `cambiosAutomaticos`), `puedeDeshacerDetencion`, `saltosAlDirecto`, `primeraImagenMs`, `reconexiones`, `lista`, `fase`. **Estado de presentación que hay que sacar**: `expandido`, `superficiesGrandes`, `visibleEnMini`, `vista`, `expandir()`, `minimizar()`, `superficieGrande(visible:)`.

Órdenes: `reproducir(_:origen:lista:)`, `detener()`, `deshacerDetencion()`, `pausar()`, `reanudar()`, `alternar()`, `irAlDirecto()`, `retroceder()` (−30 s), `cambiarCanal(±1)`, `cambiarModo(_:)` (persistido en `es.ismaeloul.aceplayerneo.modo`), `pausaDelSistema()`, `finDeInterrupcion(reanudar:)`, `tic()`, `latir()`, `fallar(…)`, `procesar(_ evento: SSEEvent)`, `volvioAPrimerPlano()`. Enganches: `alFallarFuente: ((FalloFuente) -> Bool)?`, `sistema: ControlesDelSistema?`, `dispositivoId`.

Mensajes literales (se enseñan en la línea de estado): «La señal se ha cortado: reconectando», «Sin señal suficiente: reintentando», «La imagen se ha quedado parada: reconectando», «<motivo> (n/max)…», «Esta fuente no responde: probando la siguiente…», «Esta fuente no responde. Prueba con otra.», «Este dispositivo ya no tiene acceso al reproductor.», «La sesión había caducado: reconectando», «La reproducción ha pasado a otro dispositivo», «La señal ha cambiado de ruta: reenganchando…», «La conversión para iPhone se ha reiniciado: reenganchando…», «El motor se ha reiniciado: reenganchando la señal…», «Otro dispositivo se ha unido: pasando a HLS…», «Vuelves a estar solo: recuperando la señal directa…».

⚠ Dos de estos textos **no existen en la web** («Esta fuente no responde. Prueba con otra.» y «La señal ha cambiado de ruta: reenganchando…») y faltan otros que la web sí dice («Señal irregular: recuperando la imagen…», «Señal recuperada», «Reconectando al volver a la app», «No se pudo abrir el canal: reconectando», «No se pudo guardar el historial»). Cambio en §3.11.8.

Swift 6: correcto. Las tareas capturan `self` fuerte en algunos casos (`tareaConexion`), sin ciclos permanentes porque terminan. Los tests lo usan con `automatico: false` y `esperar` inmediato.

#### 3.8.7 `ControlesSistema` (pantalla de bloqueo, Centro de Control, sesión de audio)

- `AVAudioSession` `.playback`, modo `.moviePlayback`, política `.longFormVideo`; interrupciones (empieza → pausa; termina con `shouldResume` → reanuda) y cambio de ruta `.oldDeviceUnavailable` → pausa.
- `MPNowPlayingInfoCenter`: título = partido o canal; artista = canal o «Ace Neo»; álbum = competición o «En directo»; `IsLiveStream = true`, tipo vídeo, carátula `UIImage(named: "Marca")` (creada `nonisolated`), `PlaybackRate` 1/0.
- `MPRemoteCommandCenter`: play, pause, toggle, siguiente/anterior (solo con lista > 1); sin barra, sin saltos.
- ⚠ **No es lo que publica la web** (`apps/web/src/player/media-session.ts`): título = canal, artista = subtítulo ‖ «Ace Player Neo», álbum «Ace Player Neo», carátula = icono de la app, y acciones play, pause, **stop**, **−30 s**, anterior/siguiente. Cambio en §3.11.6.
- Alternativa iOS 16+: `MPNowPlayingSession(players:)` con `automaticallyPublishesNowPlayingInfo`; no merece la pena cambiar lo que ya funciona.

#### 3.8.8 `SuperficieVideo`, `GestorPiP`, AirPlay y orientación (`SuperficieVideo.swift`)

- **Una sola `AVPlayerLayer`** (`CapaVideoUIView`, `layerClass = AVPlayerLayer`). Las pantallas ponen **huecos** (`VistaVideo(superficie:prioridad:gravedad:)` → `HuecoVideoUIView`); la capa va al hueco en ventana de más prioridad (`grande 3 > integrado 2 > mini 1`; a igualdad, el último que llegó). Resuelve el «vídeo doble» al volver del PiP. **Imprescindible reutilizarla**: la web también tiene un único `PlayerSurface` que se mueve de sitio (`stage-slot.ts`).
- `GestorPiP` (`@MainActor @Observable`): `activo`, `arrancando`, `soportado`, `superficie`, `posible`, `alternar()`, `cerrar()`, `pasoASegundoPlano()` (sin PiP suelta el `player` de la capa para que siga el audio), `volvioAPrimerPlano()` (lo recupera y cierra el PiP para que el vídeo vuelva a la app), `alRestaurar` (async: enseñar el reproductor y SOLO después completar con `true`), `alEmpezar`. `canStartPictureInPictureAutomaticallyFromInline = true` (PiP automático al salir de la app). Controlador detrás de `ControladorPiP` para probarlo con un doble.
- `DelegadoPiP`: métodos `nonisolated` + `MainActor.assumeIsolated`; `CompletarRestauracion: @unchecked Sendable`. Con Swift 6.2: `extension DelegadoPiP: @MainActor AVPictureInPictureControllerDelegate` (conformidad aislada) y quitar los `assumeIsolated`.
- `BotonAirPlay` (`AVRoutePickerView`, `prioritizesVideoDevices`, tinte blanco, activo `Accent`, etiqueta «AirPlay»).
- `Orientacion.pedir(_ mascara:)`: `requestGeometryUpdate(.iOS(interfaceOrientations:))` + `setNeedsUpdateOfSupportedInterfaceOrientations()`.

#### 3.8.9 `GestosReproductor` (reglas de gestos) — patrón sí, números no

Funciones puras con tests: `alSoltarMini`, `armadoMini`, `desplazamientoMini`, `alSoltarGrande`, `desplazamientoGrande`, `progreso`, `escala` (1 → 0,92 a 320 pt), `radio` (0 → 34 pt a 60 pt), `opacidadCuerpo` (1 → 0,25 a 200 pt), `alSoltarFuente`, `armadoFuente`, `desplazamientoFuente`, `resistencia(valor, tope) = tope·(1 − 1/(valor/tope + 1))`. Umbrales: subir 36 pt abre, bajar 44 pt detiene, lateral 80 pt cambia de fuente, 110 pt arma minimizar, minimizar con `min(150, max(80, alto×0,18))` o velocidad > 40 % del alto. **Son los del prototipo de Palco, no los de la web** (`MiniPlayer.tsx`: `DISMISS_PX = 72`). La interfaz nueva reescribe estas funciones con los números de la web y conserva la forma (funciones puras + `GestosReproductorTests`).

### 3.9 Reglas y modelos de «Features» y «Design»

#### 3.9.1 `CentroPartidoModelo` (port de `features/sources/session.ts`) — N

`@MainActor @Observable`, por partido. Estado: `resolucion`, `entradas: [EntradaFuente]`, `trabajo: ScanJob?`, `cargando`, `fallo`, `automatico`, `sinComprobador`, `vistaAbierta`, `precalentado`, `reportes`, `pegados`. API: `contexto`, `suenaAqui`, `vista(abierta:)`, `terminado`, `progreso`, `efectivos(ahora:)`, `resumen`, `entradaEnPantalla`, `indiceEnPantalla`, `precalentar()`, `cargar(rebuscar:)` (avisos «No se han encontrado fuentes nuevas» / «Fuentes actualizadas»), `procesar(_ evento:)` (`scan.progress`, `scan.verdict`…), `elegir(_:)`, `verMejor()`, `verAhora()`, `elegirSiguiente(±1)`, `puedeZapear`, `pegar(_:recordar:)`, `reportar(_:motivo:)`, `corregir(_:correcto:)`, `dormir()`. Política única: en automático, al agotarse una fuente se pasa a la siguiente verificada no probada; en cuanto la persona elige, nunca se salta sola.

Cambio necesario: sustituir `private unowned let app: AppModel` por un protocolo (`ContextoCentro`: `api`, `reproductor`, `avisar(_:tono:)`) para no depender del `AppModel` partido y para no arriesgar un `unowned` colgando en los tests.

#### 3.9.2 `ReglasFuentes` (port de `features/sources/model.ts`) — N

`SondaFuente`, `ResumenFuentes`, `EntradaFuente`, `MotivoReporte`, `VeredictoReproductor`, `EnPantalla`, `Efectivo`; `vigenciaVeredicto` 3 min, `cuarentenaLocal` 30 min, `caidaTrasSegundos` 60; `reportada`, `efectivo`, `porcentaje`, `senal`, `motivosReporte`, `etiqueta`, `detalle`, `proveedor`, `parteCanal`, `nombreVisible`, `elegirAutomatica`, `veredictoFallo`, `sinDuplicados`, `hashValido` (texto «Introduce un Content ID o enlace AceStream válido de 40 caracteres.»), `progreso`, `terminado`, `resumen`, `calidad`, `chipsCartel`, `zapeables`. Regla D6: fuente HEVC verificada cuenta como verificada en iOS si `reproducibleEnIOS`. Revalidar textos contra la web al pintar.

#### 3.9.3 Agenda — R

- `AgendaViewModel` (N): `agenda`, `actualizadaEn`, `cargando` (empieza en `true`), `fallo`, `dias`, `diaInicial`, `arrancar()` (caché → red), `refrescar()`.
- `RelojMadrid` (fecha + minutos en `Europe/Madrid`), `ReglasAgenda` (`numeroDia`, `minutosDeHora`, `minutosParaPartido`, `estado`, `porCompeticion`, `modoEfectivo`, `visibles`, `porFase`, `destacado`, `precalentables`), `FormatoAgenda` (`clave`, `partesDia`, `zona`, `calendario`, `dia`, `etiqueta`, `equipos`, `detalle`, `partidos(n)`, `chipHora`, `diaSemanaCorto`), `Marcador` (`minuto`, `progreso`, `texto`, `reloj`), `AntiSpoiler.tapado`, `RegistroGoles.anotar`.
- La web tiene su versión en `features/agenda/domain.ts` (`madridClock`, `madridHour`, `addDays`, `minutesToMatch`, `matchStatus`, `keepUnitsTogether`, `dayLabel`, `defaultDay`) y `features/agenda/cards.ts` (`versusSide`, `versusWhen`, `signalWord`, `signalTone`, `matchGlow`). **Portar desde ahí** y añadir sus casos a `generar-vectores.mjs`; lo que coincida de lo actual se aprovecha.

#### 3.9.4 Biblioteca — R

`SeccionBiblioteca` (favoritos/recientes/listas), `GrupoCategoria`, `GrupoRecientes`, `ReglasBiblioteca` (`categoriaPorDefecto` «General», `seccionInicial`, `items`, `plegar`, `filtrar` sin acentos, `porCategoria`, `porTramos`, `categoriasVacias`, `subtitulo`, `caido`, `pie`, `fechaCorta`), `EnAntena`/`IndiceAntena` (qué emite cada canal hoy, ventana de partido 120 min). Revalidar contra `features/library` y `features/biblioteca` de la web.

#### 3.9.5 Ajustes — R

- `DondeSuena` (N/R): `esEste` (por `deviceId` o `viewerId`), `nombre` («iPhone», «Navegador», «Versión anterior de la web», «Dispositivo»), `icono` (iphone/ipad/tv/desktopcomputer), `protocolo` («HLS para iPhone», «HLS», «MPEG-TS»), `titulo` («Canal <8 hex>…»), `ordenar`. Revalidar con `features/where-playing`.
- `TipoGusto` + `GustosEditables` (port de `preferences/model.ts`): banderas de 14 países (resto 🌍), `colapsar`, `limpiar` (`cleanPreferenceList`), `desde`, `mismo`, `alternar`, `anadir` (≥ 2 caracteres), `opciones`.
- `Apariencia` (`sistema/claro/oscuro`, clave `es.ismaeloul.aceplayerneo.apariencia`). La web usa `data-theme` + `data-scheme`: conservar la misma semántica, con la **clave de la web** `aceneo-tema` y migración en el primer arranque (a1 §13.10); lo mismo para el modo de reproducción (`es.ismaeloul.aceplayerneo.modo` → `aceneo-pb`).

#### 3.9.6 Colores de club y cápsula de señal — reescribir

- Swift actual (`Design/Escudos.swift`): distancia en RGB lineal < 0,18 o mismo tono (±25°) con luminancia parecida (±0,22) → secundario del visitante → si aún choca, **mitad derecha** oscurecida un 30 %; color por nombre `RGB(tono: ColorEquipo.tono(nombre))`.
- Web (`apps/web/src/lib/teams.ts` + `lib/color.ts`): **ΔE en OKLab < `VERSUS_DELTA`** → secundario del visitante → si aún choca, se oscurece **la mitad más clara** (L − 0,18); tono por nombre `hueFromName` evitando las franjas de estado (`isForbiddenHue`); `teamLight`, `channelTone`, `competitionShort`, `teamInitials`.
- Son algoritmos distintos: la tarjeta versus no quedaría igual. Portar `color.ts`/`teams.ts` a Swift y validarlos con vectores.
- `ReglasSenal.capsula` sale del prototipo (`SignalCapsule`); la web usa `cards.ts` (`signalWord`, `signalTone`). Reescribir.
- `EquipoEscudo.monograma` y `FormaEscudo` (forma de escudo generada): mirar si la web genera escudos igual (`teamInitials`, componentes de escudo de la web) antes de conservarlos.

#### 3.9.7 Otros modelos rescatables

- `BuscarModelo` (espera 450 ms, mínimo 2 caracteres, no busca si es un hash válido, cancela con `.task(id:)`): revisar el retardo de la web.
- `HermanasModelo` (fuentes del mismo canal por nombre, `API.resolver(canales:cliente:"ios")`).
- `Aviso`/`Avisos` (un toast a la vez, 3,2 s por defecto, acción opcional). Ojo: la web pinta el aviso **abajo, encima de la barra** (captura `agenda-390x844-oscuro.png`), la app actual arriba. **No se rescata tal cual**: se reescribe como port de `notices/*` (máx. 2 a la vez, 2,8 s, «×n», línea de estado 4,5 s…), ver §3.11.4.

### 3.10 Depuración: servidor y motor simulados (`Sources/Debug/*`, solo `#if DEBUG`)

- `ServidorSimulado.entorno()`: `URLSessionConfiguration.ephemeral` con `protocolClasses = [ProtocoloSimulado]`, `ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.uitests")` borrado al arrancar, `MemoryTokenStore`, caché en un directorio temporal único. Con `-AceNeoEmparejado`: dirección `http://umbrel.local:7792` y token `dev_simulado.AAAA…`.
- Código válido **`482913`**; estado mutable en `OSAllocatedUnfairLock<Estado>` (favoritos, gustos LaLiga/Real Madrid/España, lo que suena, dos listas «Lista de Isma» y «Respaldo»).
- Datos: agenda de hoy/mañana/pasado (`HOY`/`MANANA`/`PASADO` sustituidos por fechas de Madrid), 9 partidos hoy (con escudos y colores en algunos, «Real Madrid - Getafe» como «tu equipo», reservas argentinas fuera de «Para ti»), marcador `sim-1` 1-0 min 54', dos fuentes verificadas por partido, biblioteca con favoritos y listas por categoría (Deportes, Generalistas), sesiones, búsqueda, escudos PNG generados a mano (círculo de color con zlib «almacenado» y CRC propio).
- La agenda tarda **0,6 s** (`Thread.sleep` en `startLoading`) para parecerse a la red.
- `MotorSimulado`: listo a 0,3 s, cabezal avanzando cada 250 ms, ventana de 60 s, colchón 4 s, `avPlayer = nil` (no hay imagen real: las capturas del simulador enseñan la caja negra del vídeo).
- Para la app nueva: ampliar con lo que pinta la web (dispositivos, salud, sistema, diagnóstico, «sonando» en biblioteca, estados vacíos) y **mover el JSON a ficheros** `.json` en una carpeta de recursos solo de Debug o construirlo con los `Codable` (evita el error de las cadenas crudas, §9.1). Ideal: reutilizar los datos de demostración de la web (`features/*/demo.ts`, `features/agenda/demo-data.ts`) generándolos con un script, para que las capturas del iPhone y de la web enseñen **los mismos datos** y se puedan comparar píxel a píxel.

### 3.11 Piezas del núcleo que NO se comportan como la web: lista de cambios obligatorios

> Añadido tras la revisión del 25-sep. Antes, varias piezas de §2–§3 se daban por buenas «tal cual» con
> números del prototipo. Contrastadas con a7 (§2.2, §4, §6, §7, §9, §12, §14.3) y con el código de la
> web (`api/client.ts`, `api/sse.ts`, `features/agenda/data.ts`, `notices/*`, `api/identity.ts`,
> `player/media-session.ts`, `player/runtime.ts`), **no lo son**. Para una app «calcada» estos cambios son
> obligatorios; cada apartado dice qué hay hoy, qué hace la web, qué hacer y qué test cambia. Las únicas
> diferencias que se mantienen a propósito están marcadas **«diferencia consciente»** con su motivo.

#### 3.11.1 Plazos, caché y reintentos de las peticiones (`Rutas.swift`, `Endpoint.swift`, `APIClient.swift`, `APIError.swift`)

**Mecanismo**. Hoy `Endpoint.peticion` hace `URLRequest(url:…, timeoutInterval: plazo)`: en `URLSession` eso es un
plazo de **inactividad** (se reinicia con cada byte), no un plazo total. La web aborta la petición entera al
cumplirse el plazo (`withTimeout` en `api/client.ts`). Cambio: plazo total con una carrera
`withThrowingTaskGroup { petición ; try await Task.sleep(for: .seconds(plazo)); throw APIError.plazo }`,
distinguiendo el plazo (se enseña) de la cancelación de quien llama (`CancellationError`, **no** se enseña).

**Valores** (web = `TIMEOUTS` de `apps/web/src/api/client.ts`; por defecto 12 s en GET y en mutaciones):

| Ruta (`enum API`) | iOS hoy | Web | Poner |
|---|---:|---:|---:|
| `ping` (carrera de direcciones) | 4 s | 12 s | **4 s** — diferencia consciente: es la carrera LAN/Tailscale de `ServerResolver`, que la web no tiene (a7 §5 lo acepta) |
| `bootstrap` | 15 | 12 (2,5 s en `detectMode`, que decide la demo: no aplica) | **12** |
| `eventos` (SSE) | 45 de inactividad | sin plazo (`EventSource`) | **45 de inactividad** — diferencia consciente: sin `EventSource` hay que detectar la conexión muerta; el servidor manda `: ping` cada 15 s |
| `estadoMotor` | 15 | 12 | **12** |
| `reiniciarMotor` | 30 | 20 | **20** |
| `stream` | 60 | 60 | 60 |
| `latido` | 10 | 12 | **12** |
| `soltar` | 10 | 12 | **12** |
| `estadoReproduccion` | 15 | 12 | **12** |
| `ajustes` | 15 | 12 | **12** |
| `reclamarCodigo` | 15 | 12 | **12** |
| `diagnosticos` / `informarFallo` | 15 | 12 | **12** |
| `biblioteca` / `cambiarBiblioteca` | 15 | 12 | **12** |
| `preferencias` / `guardarPreferencias` | 15 | 12 | **12** |
| `directorios`, `activarDirectorio`, `borrarDirectorio` | 15 | 12 | **12** |
| `sincronizarDirectorio` | 50 | 50 | 50 |
| `agenda` (`GET football`) | **65** | **14** | **14** |
| `resolver` | 30 siempre | **20 al entrar** (`RESOLVE_TIMEOUT_MS`), **30 al rebuscar** (`RESEARCH_TIMEOUT_MS`) (`features/sources/session.ts`) | **20 / 30** según `rebuscar` |
| `comprobacion` (`football/scans/:id`) | 15 | **5** | **5** |
| `precalentado`, `vincular`, `marcadores` | 15 | 12 | **12** |
| `reportarFuente`, `resultadoFuente`, `correccionFuente` | 15 | 12 | **12** |
| `buscar` | 20 | 15 | **15** |
| Escudos y logos (URL) | por defecto de `URLSession` (60 s de inactividad) | sin plazo (`<img>`) | igual |

Para no volver a divergir: generar `PlazosWeb.swift` con un script (`scripts/generar-plazos.mjs`, mismo patrón que
`generar-catalogo-errores.mjs`) que lea `TIMEOUTS`, `DEFAULT_GET_TIMEOUT`, `DEFAULT_MUTATION_TIMEOUT`,
`RESOLVE_TIMEOUT_MS` y `RESEARCH_TIMEOUT_MS`, con `--check` en la CI.

**Caché HTTP**. Hoy `URLSessionConfiguration` con `useProtocolCachePolicy`: si el servidor manda `max-age`,
`URLSession` puede servir de caché **sin revalidar**. La web pide los GET con `cache: 'no-cache'` (siempre revalida
con el ETag) y el resto con `no-store` (a7 §3.1). Poner `.reloadRevalidatingCacheData` en GET y
`.reloadIgnoringLocalCacheData` en el resto.

**Reintentos**. Hoy: un solo reintento, solo tras un fallo de conectividad, solo si la ruta es idempotente, y contra
la otra dirección. Web (a7 §4.1): las **consultas** se reintentan 2 veces (1 s y 2 s) si el error es `retryable`
(`network`, `timeout`, estado ≥ 500 o 429); las **mutaciones nunca**. Hacer:
- el reintento con la otra dirección **se queda** (es el cambio automático casa/Tailscale permitido), pero solo en GET:
  `guardarPreferencias` (`PUT preferences`, hoy `idempotente: true`) pasa a `false`;
- la política 1 s / 2 s va en la capa de caché de consultas (`CacheConsultas`, a7 §14.1), no en `APIClient`.

**Textos del cliente** (`APIError.mensaje`), a7 §3.3:

| Caso iOS | Texto iOS hoy | Texto web (poner) |
|---|---|---|
| `red(.notConnectedToInternet…)` y demás fallos de red | «No hay conexión a internet.» / «No se ha podido conectar con el servidor.» | «No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando.» |
| `red(.timedOut)` y el plazo nuevo | «El servidor ha tardado demasiado en responder.» | «El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.» |
| `formato` | «La respuesta del servidor no tiene el formato esperado. Puede que la app y el servidor tengan versiones distintas.» | «El servidor ha respondido algo que no se entiende.» |
| cualquier otro error no `APIError` | — | «Algo ha fallado en el servidor. Queda anotado en el registro.» (`describeFailure`) |
| `sinServidor`, `servidorInalcanzable`, `noEsAcePlayerNeo`, `versionIncompatible`, ATS | textos propios (§3.4.4) | **se quedan**: diferencia consciente (emparejar y red casa/Tailscale son añadidos permitidos; la web no tiene esos casos) |

Tests: `EndpointTests` (un caso por plazo, o comparar con el fichero generado), `APIClientTests` (plazo total que
vence con un servidor que gotea bytes; `PUT` no se repite; política de caché), `CatalogoErroresTests` (textos nuevos).

#### 3.11.2 Tiempo real (`SSEClient.swift` y `AppModel.arrancarTiempoReal/pararTiempoReal/volvioAPrimerPlano/pasoASegundoPlano`)

| Aspecto | iOS hoy | Web (`api/sse.ts`, `realtime-store.ts`; a7 §6) | Hacer |
|---|---|---|---|
| Espera entre reconexiones | 1, 2, 4, 8, 16, 30, 30… s (`esperaInicial 1`, `esperaMaxima 30`), o el `retry:` del servidor si es mayor | `min(60 s, 3 s × 2^min(intentos−1, 5))` → **3, 6, 12, 24, 48, 60, 60…** s | `esperaInicial = 3`, `esperaMaxima = 60`, exponente con tope 5. El `retry: 3000` del servidor coincide con la primera |
| Estados publicados | `.conectado`, `.evento`, `.desconectado(error, reintentoEn)`, `.necesitaEmparejar` | `idle → connecting → open`; **`fallback`** si en **10 s** no ha abierto; `demo` | Añadir `EstadoTiempoReal` (`inactivo/conectando/abierto/respaldo/demo`) observable por la interfaz (el indicador del motor y las consultas lo leen) |
| Respaldo por sondeo | **ninguno** | A los 10 s sin abrir: cada **5 s** vuelve a pedir las consultas **activas** de `playback` y cada **20 s** las de `engine/status`; nada con la página oculta. Si cambia `nowPlaying`, emite un `playback.nowPlaying` **sintético** (el reproductor late y comprueba si le han quitado el mando) | Implementar en `TiempoReal` + `CacheConsultas`; solo con `scenePhase == .active` |
| Al abrir tras un corte | nada (salvo `resync`) | invalida `playback` y `engine/status` | Igual |
| `Last-Event-ID` | lo manda `SSEClient` entre sus propias reconexiones, pero `AppModel` **reconecta desde cero** al volver de segundo plano (`conectar()` sin argumento) y pide `bootstrap` | lo pasa siempre al reabrir (`?lastEventId=`); el servidor guarda 200 eventos y, si ya no está, manda `resync` (invalidar todo) | Guardar el último id en `TiempoReal` (memoria de proceso) y reanudar con él; **quitar** el `bootstrap` incondicional al volver (solo si llega `resync`) |
| Segundo plano | corta el SSE siempre | (navegador) — a7 §14.2: si **no** suena nada, cerrar SSE y sondeos; si suena (audio, PiP, AirPlay), mantener latido y SSE mientras iOS lo permita | Cambiar `pasoASegundoPlano()` |
| Vuelta a primer plano | reconecta sin id | si no está abierto, reconecta **ya** (`visibilitychange`) | Reconectar ya con el id guardado; latido inmediato si suena algo |
| Inactividad | 45 s | — | 45 s (diferencia consciente, ver §3.11.1) |

Tests: `SSETests.testEsperaExponencialConTopeYRetryDelServidor` pasa a 3/6/12/24/48/60/60; nuevos: respaldo a los 10 s, reanudar con
`Last-Event-ID` tras segundo plano, `resync` invalida todo, sintético de `playback.nowPlaying`.

#### 3.11.3 Sondeos de datos (`AppModel`)

| Pieza | iOS hoy | Web | Hacer |
|---|---|---|---|
| `vigilarMarcadores()` | `GET scores` **cada 60 s**, siempre que la app está emparejada | `useScores` (`features/agenda/data.ts`): la consulta **solo existe** si el día que miras tiene algún partido con `start` entre **15 min antes y 3,5 h después**; cada **8 s** si algún marcador está `in`, cada **45 s** si no; `staleTime 5 s`; no se repite al volver a primer plano; se para con la vista oculta. En Canales («Emitiendo ahora», `useOnAir`): si **hoy** hay algún partido con minutos hasta el inicio ∈ **[−210, 15]**, mismo 8/45 s. El mini solo lee la caché | Portar `scoresWanted` y `scoresInterval` y atar el sondeo a la pantalla visible (`.task(id: díaElegido)` en Agenda/Partido/Canales), no a un bucle global |
| `vigilarSesiones()` | `GET playback` **cada 20 s** | Con el SSE abierto **no se sondea**: `playback.sessions` y `playback.nowPlaying` actualizan la caché; «Dónde se está reproduciendo» pide al entrar (`refetchOnMount: 'always'`); sin SSE, el respaldo de 5 s de §3.11.2 | **Quitar** el bucle |
| `precalentar(_:)` | Hasta **6 partidos**: crea un `CentroPartidoModelo` por partido y llama a `precalentar()` | `useMatchSignal` **por tarjeta montada** (héroe, filas del día y filtro elegidos, panel lateral y «Luego» en iPad): `GET football/preheat/:matchId` solo si el partido tiene canales, está en su ventana (**45 min antes → 120 min después** de `start`) y no ha terminado; se repite cada **30 s solo sin SSE**. Encima, el almacén de `scan.progress` por `matchId` (vale **20 min**; `cancelled` lo borra). Fuera de ventana: «Pendiente» si empieza en ≤ 6 h; si no, nada. **No** se crea ninguna sesión de fuentes hasta que entras al partido | Sustituir por `SenalPartidos` (a7 §14.1) + una consulta por tarjeta; `CentroPartidoModelo` solo para el partido abierto y el que suena |

Tests: nuevos con reloj inyectado (ventanas 15 min/3,5 h, [−210, 15], 45/120 min; intervalos 8/45/30 s).

#### 3.11.4 Avisos (`Aviso`/`Avisos` en `Design/Componentes.swift`)

| Aspecto | iOS hoy | Web (`notices/toasts.ts`, `statusLine.ts`, `Toaster.tsx`; a7 §12.1, a2 §8) |
|---|---|---|
| A la vez | **1** (el nuevo sustituye) | **2** como máximo (`TOAST_MAX`; sale el más viejo) |
| Duración | **3,2 s** | **2,8 s** (`TOAST_MS`), o `ms`; con «Deshacer» **6 s** |
| Repetidos | se apilan/sustituyen | mismo tono + texto no se apila: renueva su tiempo y enseña «×n» desde 2 |
| Salida | — | fundido **320 ms** (`FADE_MS`) |
| Posición | **arriba** | **abajo**: `bottom = toastBottom + safeB + 12` con `toastBottom` = `64 + 10 + 72 + 20` (barra + hueco + mini + 20) con mini, `64 + 10 + 8` sin mini, `72 + 16` con mini sin barra, 0 si no; desde 768 de ancho, abajo a la derecha (`safeR + 20`, `safeB + 20`, ancho `min(420, ancho − 40)`), y entre 768 y 919 con mini a `safeB + 72 + 32` |
| Tipos | uno | `kind: 'signal'` → **línea de estado** sobre el vídeo (4,5 s, uno a la vez) si estás en el partido y no lleva acción; `kind: 'action'` → toast siempre |
| Inmersivo | se pinta | **ningún toast** con el vídeo a pantalla completa o en horizontal en el partido |
| Icono | — | por tono: ok `check`, info `info`, warn/err `aviso`, salvo el suyo |

Hacer: `@Observable Avisos` nuevo como port literal de `notices/*` (cola de toasts + línea de estado + estado base del
reproductor), con `AccessibilityNotification.Announcement`. De lo actual solo sirve la idea de «aviso con acción».
Tests: portar `notices.test.tsx` y `wording.test.ts`.

#### 3.11.5 Identidad del visor (`IdentidadVisor` en `ServicioReproduccion.swift`)

| | iOS hoy | Web (`api/identity.ts`) | a7 §7 |
|---|---|---|---|
| Formato | `ios_` + UUID sin guiones (36 caracteres) | `v_` + base64url de 10 bytes (16 caracteres) | `v_` + 14 |
| Vida | **persistente** en `UserDefaults` (`es.ismaeloul.aceplayerneo.visor`) | solo en memoria, **una por carga** de página | una por **arranque de proceso** |

El servidor solo exige `^[A-Za-z0-9_-]{4,64}$` (sin prefijo: comprobado en `packages/shared/src/api/v1/playback.ts`),
así que las dos cosas funcionan. Diferencia práctica: con el visor persistente, si iOS mata la app mientras suena,
al volver a abrirla el `channelStream` nuevo **sustituye** la sesión vieja al momento; con uno por proceso (web), la
vieja queda viva hasta que el servidor la da por ida (45 s sin latido) y «Dónde se está reproduciendo» enseña dos
filas del iPhone durante ese rato, igual que la web al recargar sin `pagehide`.
**Decisión propuesta: alinear con la web** (`v_` + 14 base64url, en memoria, uno por proceso) y soltar la sesión con
`reason: 'user'` al detener, como la web; «Este dispositivo» se decide por `deviceId`, así que no cambia nada visible.
Si Isma prefiere evitar la fila fantasma de 45 s tras un cierre forzado, la alternativa es mantenerlo persistente
**con el formato de la web** (`v_` + 14) — anotarlo entonces como diferencia consciente.
Tests: el de «visor» de `MaquinaYDirectoTests` (formato y vida).

#### 3.11.6 Pantalla de bloqueo y Centro de Control (`ControlesSistema.swift`)

| Campo | iOS hoy | Web (`player/media-session.ts`; a4 §21, a7 §9.6) | Poner |
|---|---|---|---|
| Título | partido («Local – Visitante») o canal | `channel.title` (el **canal**: en un partido, el de la fuente que suena, p. ej. «DAZN»; `channelTitleFor` en `session.ts`) ‖ «Ace Player Neo» | canal ‖ «Ace Player Neo» |
| Artista | canal (si hay partido) o «Ace Neo» | `channel.subtitle` ‖ «Ace Player Neo». Subtítulo: en un partido «Fuente {n}, {proveedor}» (p. ej. «Fuente 1, Elcano»); en un canal con varias fuentes «Fuente {n} de {total}»; si no, nada | igual |
| Álbum | competición o «En directo» | «Ace Player Neo» | «Ace Player Neo» |
| Carátula | `UIImage(named: "Marca")` (variante clara u oscura según la apariencia) | `icon-192.png` / `icon-512.png` (el icono oscuro, único) | el icono oscuro siempre (§7.4) |
| Estado | `PlaybackRate` 1/0 | `playing` en reproduciendo y `buffer`; `paused` en pausado; `none` en el resto; metadatos a `null` si `idle` o `error` | `nowPlayingInfo = nil` en idle/error; rate 1 en reproduciendo/buffer, 0 en pausado |
| Comandos | play, pause, toggle, anterior/siguiente (lista > 1); `skipBackwardCommand` **desactivado**; sin stop | play, pause, **stop**, **seekbackward** (−30 s, `BACK_SECONDS`), previoustrack/nexttrack **solo si hay zapping** (anterior y siguiente) | añadir `stopCommand` → detener (el mismo `stop()` del reproductor) y `skipBackwardCommand` con `preferredIntervals = [30]` → `retroceder()`; `togglePlayPauseCommand` se queda (auriculares: diferencia consciente e inocua) |
| `IsLiveStream = true`, tipo vídeo | sí | — | se queda (diferencia consciente: iOS enseña «EN DIRECTO» y quita la barra) |

Tests: `SistemaTests` («Now Playing + comandos») con los textos y comandos nuevos.

#### 3.11.7 Primer fotograma (`MotorAVPlayer.swift`)

- iOS hoy: `.primerFotograma` cuando, reproduciendo, el cabezal avanza **> 0,2 s** (`UmbralesReproductor.avanceMinimoS`), visto en el sondeo de 250 ms. Llega ~150–400 ms tarde respecto a la imagen.
- Web (`player/runtime.ts` ~L884-906): `requestVideoFrameCallback` (el primer fotograma **pintado**) o, de respaldo, cabezal **≥ 0,05 s** desde que empezó a reproducir.
- a7 §14.3: `AVPlayerLayer.isReadyForDisplay` + `timeControlStatus == .playing` + cabezal ≥ 0,05 s.
- Hacer: en el mismo tic de 250 ms, `primerFotograma` = `capa.isReadyForDisplay && timeControlStatus == .playing && avance ≥ 0,05`; sin capa (PiP, segundo plano, AirPlay) solo el avance ≥ 0,05 (como el respaldo de la web con la pestaña oculta). La capa única es la de `SuperficieVideo`; el motor necesita una referencia débil a ella o un cierre `listoParaPintar: () -> Bool`. **No** KVO directo (aprendizaje §9.10). `avanceMinimoS = 0,2` se queda para el **vigilante** (la web también usa 0,2 ahí).
- Efecto si no se cambia: `arranco`, `timeToFirstFrameMs` de las métricas y «Señal recuperada» salen en otro momento que en la web.
- Tests: `MotorAVPlayerTests` (HLS real) y un caso de `ReproductorTests` con el umbral 0,05.

#### 3.11.8 Mensajes del reproductor que no son los de la web (`Reproductor.swift`)

| Situación | iOS hoy | Web | Poner |
|---|---|---|---|
| Fuente agotada y nadie ha puesto otra (`Reproductor.swift:709`) | «Esta fuente no responde. Prueba con otra.» | el `message` que devuelve la sesión de fuentes (`onSourceFailed`) o «Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía.» (aviso `err`, medidor `fail`; reposo `fallo`) | el de la web |
| Latido con otra ruta de vídeo (`Reproductor.swift:754`) | «La señal ha cambiado de ruta: reenganchando…» | latido con otra `url` o `protocol` → «Otro dispositivo se ha unido: pasando a HLS…» | En iOS el protocolo es siempre `hls-fmp4` y la ruta solo cambia cuando el servidor rehace el remux: usar **«La conversión para iPhone se ha reiniciado: reenganchando…»** (texto de la web para `stream.reopened` `remux_restart`, a7 §9.5). Decisión anotada: la web no tiene un texto exacto para este caso |
| Imagen irregular (máx. 1 por minuto) | — | «Señal irregular: recuperando la imagen…» | añadir |
| Vuelve la imagen tras reconectar | — | «Señal recuperada» (ok) | añadir |
| Vuelta a primer plano con el medio roto | — | «Reconectando al volver a la app» | añadir |
| Error al abrir que no es de la API | — | «No se pudo abrir el canal: reconectando» | añadir |
| Falla `history-upsert` | — | «No se pudo guardar el historial» (toast warn) | añadir |
| Reposo (`IDLE_MESSAGES`) y estado base (`statusFor`) | propios de `FaseReproductor.etiqueta` | a7 §9.5 y §9.7 | los de la web |

Para no volver a divergir: una prueba que compare el catálogo de textos del reproductor Swift con uno generado desde
`player/runtime.ts`, `player/status.ts` y `features/sources/session.ts` (patrón de `generar-catalogo-errores.mjs`).

#### 3.11.9 Resumen: qué cambia en el núcleo

| # | Fichero | Cambio | Test |
|---|---|---|---|
| 1 | `Endpoint.swift`, `APIClient.swift` | plazo total; caché `reloadRevalidating`/`reloadIgnoring`; reintento de dirección solo en GET | `APIClientTests`, `EndpointTests` |
| 2 | `Rutas.swift` (+ `PlazosWeb.swift` generado) | plazos de la tabla §3.11.1; `resolver` 20/30 s | `EndpointTests` + `--check` en CI |
| 3 | `APIError.swift` | textos de red/plazo/formato de la web | `CatalogoErroresTests` |
| 4 | `SSEClient.swift` + `TiempoReal` nuevo | esperas 3·2ⁿ (tope 60), estados, respaldo 10 s (5 s / 20 s), `Last-Event-ID` al volver | `SSEClientTests` |
| 5 | `AppModel` → `SesionApp` | marcadores por ventana 8/45 s, sin bucle de sesiones, señal por tarjeta, segundo plano según suene o no | nuevos con reloj inyectado |
| 6 | `Avisos` | port de `notices/*` | port de `notices.test.tsx` |
| 7 | `IdentidadVisor` | `v_` + 14, por proceso (o persistente con ese formato si Isma lo prefiere) | `MaquinaYDirectoTests` |
| 8 | `ControlesSistema.swift` | metadatos y comandos de la web | `SistemaTests` |
| 9 | `MotorAVPlayer.swift` | primer fotograma con `isReadyForDisplay` + 0,05 s | `MotorAVPlayerTests`, `ReproductorTests` |
| 10 | `Reproductor.swift` | textos de §3.11.8 | catálogo generado |

---

## 4. Interfaz que se borra (lista exacta)

```
Sources/App/RootView.swift
Sources/Design/CapsulaSenal.swift        (tras portar la regla desde cards.ts)
Sources/Design/CartelFuente.swift
Sources/Design/Componentes.swift         (tras sacar Aviso/Avisos y, si sirve, DisposicionFlujo)
Sources/Design/Escudos.swift             (tras portar teams.ts/color.ts)
Sources/Design/EstadosVista.swift
Sources/Design/ImagenCacheada.swift      (se rehace igual)
Sources/Design/Palco.swift
Sources/Design/TarjetaVersus.swift
Sources/Design/Tema.swift                (tras sacar Apariencia)
Sources/Features/Agenda/AgendaView.swift
Sources/Features/Library/CanalesView.swift
Sources/Features/MatchCenter/EscenarioView.swift   (tras sacar HermanasModelo)
Sources/Features/MatchCenter/HojasEscenario.swift
Sources/Features/Pairing/PairingView.swift
Sources/Features/Search/BuscarView.swift           (tras sacar BuscarModelo)
Sources/Features/Settings/AjustesView.swift
Sources/Features/Settings/DondeSuenaView.swift     (tras sacar enum DondeSuena)
Sources/Features/Settings/GustosView.swift         (tras sacar TipoGusto y GustosEditables)
Sources/Features/Settings/ListasView.swift
Sources/Player/ReproductorVistas.swift
Resources/Assets.xcassets/Colores/*      (se borran todos salvo Bg, que pide la pantalla de arranque; §7.5)
```

Unas 7 900 líneas. Antes de borrar, mover a `Core/` (o a un paquete, §7.2) lo marcado «tras sacar…».

---

## 5. Tests unitarios: qué se queda y qué se reescribe

| Fichero · clase | Tests | Prueba | Veredicto |
|---|---:|---|---|
| `APIClientTests` | 11 | Bearer y `/native`, ping y claim sin token, sin token no sale a la red, 401 borra y avisa, código incorrecto ≠ perder acceso, mensaje del catálogo, error sin cuerpo, respuesta mal formada, reintento con la otra dirección, no idempotente no se repite, cuerpo de mutación | **Se queda** |
| `EndpointTests` (mismo fichero) | 6 | `+` y espacios, `stream` con `client=ios`, canal repetido, base con barra/ruta, ids raros, política de reconexión | **Se queda** |
| `ReglasAgendaTests` | 6 | Días, reloj de Madrid, insignias, grupos, «Para ti», tira de días | **Reescribir** contra `agenda/domain.ts` (vectores) |
| `ReglasBibliotecaTests` | 4 | Categorías, tramos, sección inicial, qué emite cada canal | Revalidar contra la web; adaptar |
| `DondeSuenaTests` | 3 | Este dispositivo, nombres e iconos, título/protocolo/orden | Se queda si `DondeSuena` pasa al núcleo |
| `GustosEditablesTests` | 3 | Marcar/desmarcar por clave, añadir a mano, topes | Se queda |
| `CacheTests` | 4 | Guardar/leer agenda, claves independientes, fichero roto, lectura rápida | **Se queda** |
| `FormatoAgendaTests` | 3 | Hoy/mañana/ayer, día de la semana, equipos | Reescribir con `dayLabel` de la web |
| `CatalogoErroresTests` | 3 | Mensajes del catálogo, interno no se enseña, mensajes propios | **Se queda** |
| `CentroPartidoTests` | 2 | Automático arranca la verificada y pasa a la siguiente; manual nunca salta | **Se queda** (adaptar constructor si se quita `AppModel`) |
| `EmparejamientoTests` | 12 | Enlace QR, enlaces inválidos, normalizar, Tailscale/LAN, direcciones fuera del Llavero, carrera de pings, ninguna responde, sin direcciones, no es Ace Player Neo, versión incompatible, emparejar guarda, código mal escrito no sale | **Se queda** (+ casos del QR con dos direcciones) |
| `FixturesTests` | 11 | Todos los ejemplos de `@ace/shared` | **Se queda** |
| `InfoPlistTests` | 5 | Nombre/bundle, ATS, audio + permisos en español, esquema `aceneo`, orientaciones | **Se queda** (+ `UIAppFonts`, familia) |
| `LlaveroTests` | 6 | Guardar/leer/borrar, sustituir, servicios, errores, cliente pide emparejar, Llavero real | **Se queda** |
| `MaquinaYDirectoTests` | 9 | Tabla, detener, fase pública, esperas, borde útil, ventana, indicador, visor, tipo | **Se queda** (el caso «visor» cambia con §3.11.5) |
| `MotorAVPlayerTests` | 2 | HLS real de Apple hasta el primer fotograma (se salta sin Internet), URL inexistente avisa | **Se queda** |
| `PalcoTests` · `ColoresVersusTests` | 6 | Algoritmo del prototipo | **Reescribir** (teams.ts/color.ts) |
| `PalcoTests` · `ChipHoraTests` | 4 | Chip de hora del prototipo | **Reescribir** (`cards.ts versusWhen`) |
| `PalcoTests` · `CapsulaSenalTests` | 2 | Cápsula del prototipo | **Reescribir** (`cards.ts signalWord/signalTone`) |
| `PalcoTests` · `AntiSpoilerTests` | 2 | Tapado/destapado | Revalidar contra `Scoreboard.tsx` |
| `PalcoTests` · `RegistroGolesTests` | 2 | Goles por dos lecturas | Revalidar |
| `PalcoTests` · `SeccionesAgendaTests` | 3 | Fases, destacado, precalentables | Reescribir según la web |
| `PalcoTests` · `ResumenFuentesTests` | 4 | Resumen, calidad, sonda, zapeables | **Se queda** |
| `PalcoTests` · `EscudosDecodificacionTests` | 3 | `homeTeam`/`awayTeam`/`competitionBadge` | **Se queda** |
| `PalcoTests` · `CacheImagenesTests` | 4 | Memoria/disco/peticiones unidas, misma clave por otra dirección, error no se guarda, PNG simulado | **Se queda** |
| `ReglasFuentesTests` | 10 | Estado efectivo, medidor, frases, arranque automático, veredicto, D6 HEVC, candidato, hash pegado, filtro sin acentos, marcador | **Se queda** |
| `ReproductorTests` | 17 | Perfil del modo, `arranco` una vez, modo sin reconectar, reconexiones y paso a la siguiente, arranque automático con 1 intento, salto al directo, pausa ajena, traspaso SSE, latido 410, firma, `stream.reopened`, evento ajeno, primer plano, detener, cambio de canal, error sin reintento, directo contra borde útil | **Se queda** (quitar asertos de `visibleEnMini` si ese estado sale del reproductor) |
| `ReproductorVisibleTests` · `GestosReproductorTests` | 9 | Umbrales del prototipo | **Reescribir** con los de la web |
| `ReproductorVisibleTests` · `VistaReproductorTests` | 1 | Mini ↔ grande | Adaptar a la presentación nueva |
| `ReproductorVisibleTests` · `SuperficieUnicaTests` | 2 | La capa va al hueco de más prioridad, nunca dos | **Se queda** |
| `ReproductorVisibleTests` · `PiPTests` | 4 | Volver con PiP cierra y el vídeo vuelve al grande; con el partido en pantalla vuelve ahí; abrir PiP minimiza; sin PiP la capa suelta el reproductor | **Se queda** (adaptar a la presentación nueva) |
| `SSEParserTests` | 10 | Parser | **Se queda** |
| `SSEClientTests` | 4 | Reconexión con `Last-Event-ID`, 401, sin token, espera exponencial | Se queda, pero **cambian** los números de la espera (3·2ⁿ, tope 60) y se añaden respaldo y reanudación (§3.11.2) |
| `SistemaTests` | 4 | Delegado del PiP, PiP sin reproductor, Now Playing + comandos, auriculares | Se queda; **reescribir** «Now Playing + comandos» con los metadatos y comandos de la web (§3.11.6) |
| `VectoresDominioTests` | 6 | Claves, ligas, «Para ti», canales, reservas argentinas | **Se queda y se amplía** |
| `Ayudas.swift` | — | `MockURLProtocol`, `Fixtures`, `ComparadorJSON`, `LlaveroSimulado`, `Prueba`, `Contador` | **Se queda** |
| `ReproductorTests.swift` (dobles) | — | `MotorFalso`, `ServicioFalso` | **Se queda** |

Aviso de compilación en los tests: `AgendaYBibliotecaTests.swift:179-181` llaman a `LogoCanal.dorsal` (aislada en `@MainActor` porque vive en una `View`) desde un contexto no aislado. Al reescribir, marcar las clases de test de reglas visuales con `@MainActor` o sacar las reglas de las vistas.

El fallo `APIClientTests/testTrasUnFalloDeRedReintentaConLaOtraDireccion` de las ejecuciones `36096292800` y `36097038209` («("2") is not equal to ("1")») **no era intermitente**: el ejemplo de agenda pasó a dos días en la 0.8.0 y el aserto se corrigió en `e944e51`. En `36099058452` todos los unitarios pasan.

---

## 6. Pruebas de interfaz (XCUITest) existentes

### 6.1 Método

- Lanzamiento con argumentos (los lee `ModoEjecucion` y, para la apariencia, el dominio de argumentos de `UserDefaults`):
  - `-AceNeoServidorSimulado` → `Entorno` con `ServidorSimulado` + `MotorSimulado` (sin red, sin Llavero).
  - `-AceNeoEmparejado` → arranca ya emparejada (junto con el anterior).
  - `-AceNeoApariencia claro|oscuro` → fuerza el esquema (solo Debug).
  - `-AceNeoEmpezarDeCero` → la app de verdad (Llavero, red, AVPlayer) sin token, sin direcciones y sin caché (E2E).
- `continueAfterFailure = false` en todas.
- E2E: `TEST_RUNNER_ACE_E2E_PUERTO` en el entorno de `xcodebuild` → `ACE_E2E_PUERTO` en el ejecutor. Sin él, `XCTSkip`.
- Los tests se buscan por **identificador de accesibilidad** con `elementoUI(app, id)` (`descendants(matching: .any).matching(identifier:)`), o por texto con `conTextoUI(app, texto)` (`label CONTAINS`). Las pestañas, por `app.tabBars.buttons["Ajustes"]` (dejará de valer con una barra propia).

### 6.2 Ficheros y pruebas

| Fichero | Prueba | Lanzamiento | Qué recorre |
|---|---|---|---|
| `EmparejamientoUITests` | `testArrancaEnLaPantallaDeEmparejar` | `-AceNeoServidorSimulado` | Sale la pantalla de emparejar |
| | `testEmparejarConElCodigoLlevaALaAgenda` | ídem | Teclea `482913` y dirección → agenda; captura `emparejar-02-agenda-tras-emparejar` |
| | `testUnCodigoIncorrectoSeExplicaEnEspanol` | ídem | Mensaje del catálogo en español (`error-emparejar`) |
| `ReproduccionUITests` | `testLaTiraDeDiasSeVeYSusDiasSePulsan` | `+ -AceNeoEmparejado` | Tira de días pintada y pulsable (`sePinta`) |
| | `testAbrirPartidoEscenarioMiniYGestos` | ídem | Partido → escenario (verificada suena) → minimizar → mini → pausa/reanuda → tocar mini abre → arrastrar vídeo abajo minimiza → arrastrar mini arriba abre → flecha minimiza → × detiene con «Deshacer» |
| | `testDeslizarElMiniHaciaAbajoDetieneConDeshacer` | ídem | Mini abajo → detiene → `aviso-accion` → deshacer |
| | `testEscenarioDeUnCanal` | ídem | Canal de la biblioteca → escenario de canal (`cabecera-canal`) |
| | `testDondeSeEstaReproduciendo` | ídem | Ajustes → sesión `sesion-s_simulada`, `visor-este-dispositivo` |
| | `testBorrarUnFavoritoYDeshacer` | ídem | Deslizar para borrar → Deshacer |
| | `testListasAgrupadasPorCategoria` | ídem | `categoria-Deportes`, `categoria-Generalistas` |
| `CapturasUITests` | `testCapturasEnClaro` / `testCapturasEnOscuro` | `+ -AceNeoApariencia` | 13 capturas por esquema (1,2 s de espera antes de cada una, `lifetime = .keepAlways`) |
| `ServidorRealUITests` | `testEmparejarReproducirDeVerdadRevocarYVolverPorElQR` | `-AceNeoEmpezarDeCero` + pila E2E | Empareja con `localhost:<puerto>` y un código creado con `POST /api/v1/pairing`, abre un partido de la agenda de demostración, **AVPlayer reproduce el HLS fMP4 que saca ffmpeg**, «Dónde se está reproduciendo», revoca (`DELETE /api/v1/devices/:id`) → vuelve a emparejar con el aviso → `app.open(enlace aceneo://…)` rellena el código → agenda. Capturas `e2e-01…06` |

Nombres de captura actuales: `<modo>-01-emparejar`, `-02-agenda-portada`, `-03-agenda-todos`, `-04-tus-gustos`, `-05-escenario`, `-06-hoja-de-fuentes`, `-07-mini`, `-08-canales`, `-09-canales-listas`, `-10-buscar`, `-11-ajustes`, `-12-ajustes-apariencia`, `-13-ajustes-listas`; `01-agenda-tira-de-dias` … `10-listas-agrupadas`; `e2e-01-emparejar` … `e2e-06-emparejada-por-qr`; `fallo-*` si falla. **Para la app nueva conviene usar los mismos nombres de vista que las capturas de la web** (`agenda`, `partido`, `reproductor`, `mini-reproductor`, `biblioteca-favoritos`, `biblioteca-recientes`, `biblioteca-listas`, `biblioteca-vacia`, `biblioteca-sonando`, `buscar`, `buscar-enlace`, `pegar`, `ajustes`, `ajustes-apariencia`, `ajustes-reproduccion`, `ajustes-donde`, `ajustes-motor`, `dispositivos`, `salud`, `preferencias`, `ayuda`, `sistema`) con el sufijo `-390x844-claro/oscuro` y `-844x390-…`, para compararlas una a una.

### 6.3 Identificadores de accesibilidad que usan hoy

| Identificador | Dónde |
|---|---|
| `campo-codigo`, `campo-lan`, `campo-tailscale`, `boton-emparejar`, `boton-escanear`, `error-emparejar` | Emparejar |
| `dia-<fecha>` (prefijo), `portada`, `lista-agenda`, `capsula-senal`, `boton-editar-gustos`, `formulario-gustos` | Agenda |
| `reproductor-grande`, `video-grande`, `cabecera-partido`, `cabecera-canal`, `selector-fuentes`, `fuente-<id>` (prefijo), `hoja-fuentes`, `boton-minimizar` | Escenario |
| `mini-reproductor`, `mini-reproducir`, `mini-detener`, `aviso-accion` | Mini y avisos |
| `lista-biblioteca`, `categoria-<nombre>`, `enlace-listas` | Canales |
| `sesion-<id>` (prefijo), `sesion-s_simulada`, `visor-este-dispositivo`, `selector-apariencia` | Ajustes |

El `label` de `video-grande` contiene la fase («Reproduciendo»): los tests esperan a ese texto. Convención a mantener en la app nueva: **el mismo identificador para la misma pieza que en la web** (`data-testid` de los tests de Playwright de la web, si existen), para que un test de interfaz se pueda escribir igual en los dos lados.

### 6.4 Ayudas que se quedan (`AyudasUI.swift`, `ServidorDePruebas.swift`)

- `elementoUI`, `conTextoUI`, `esperarQueDesaparezca(_:plazo:)`.
- `arrastrar(_:desde:hasta:)` con `press(forDuration: 0.05, thenDragTo:)` — más fiable que `swipeUp()`.
- `tocarPestana` (despliega la barra plegada de iOS 26 con `swipeDown`) — adaptar a la barra propia.
- `diasDeLaAgenda`, `comprobarTiraDeDias` y **`sePinta`**: compara el color de un píxel del elemento con el del fondo de la misma franja (diferencia > 60) porque XCUITest da por «hittable» lo que no se pinta. Muy útil para el calco.
- `ServidorDePruebas` (`crearCodigo()`, `revocarTodos()`) con `HTTPCrudo` sobre `NWConnection` (el ejecutor de pruebas no tiene excepciones de ATS para `URLSession` a una IP en claro).

---

## 7. Proyecto (XcodeGen) y opciones de compilación

### 7.1 Hoy (`project.yml`)

- `name: AceNeo`, `bundleIdPrefix: es.ismaeloul`, `deploymentTarget.iOS: "17.0"`, `developmentLanguage: es`, `createIntermediateGroups`, `groupSortPosition: top`.
- `configFiles`: `Config/AceNeo.xcconfig` para Debug y Release (incluye `Config/Local.xcconfig` opcional, fuera de git).
- Ajustes base: `SWIFT_VERSION 6.0`, `SWIFT_STRICT_CONCURRENCY complete`, `IPHONEOS_DEPLOYMENT_TARGET 17.0`, `TARGETED_DEVICE_FAMILY "1,2"`, `ENABLE_USER_SCRIPT_SANDBOXING YES`, `LOCALIZATION_PREFERS_STRING_CATALOGS YES`, `DEAD_CODE_STRIPPING YES`, `CODE_SIGN_STYLE Automatic`, `DEVELOPMENT_TEAM ""`. Debug `-Onone`; Release `-O` + `wholemodule`.
- Objetivo `AceNeo` (application): fuentes `Sources` + `Resources`; `PRODUCT_BUNDLE_IDENTIFIER $(ACE_BUNDLE_ID)`, `INFOPLIST_FILE Config/Info.plist`, `GENERATE_INFOPLIST_FILE NO`, `ASSETCATALOG_COMPILER_APPICON_NAME AppIcon`, `…GLOBAL_ACCENT_COLOR_NAME AccentColor`, **símbolos de assets desactivados** (`ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS NO`, `…GENERATE_ASSET_SYMBOLS NO`), `ENABLE_PREVIEWS YES`, sin Catalyst ni «Designed for iPhone» en Mac.
- `AceNeoTests` (unit): `Tests/AceNeoTests` + **`../../packages/shared/fixtures` como carpeta de recursos**; `TEST_HOST` = la app.
- `AceNeoUITests` (ui-testing): `Tests/AceNeoUITests`, `TEST_TARGET_NAME AceNeo`.
- Esquema `AceNeo`: test en Debug con cobertura de `AceNeo`, los dos objetivos de test `parallelizable: false`; archive en Release.
- `.gitignore`: `*.xcodeproj/`, `*.xcworkspace/`, `build/`, `DerivedData/`, `*.xcresult/`, `*.ipa`, `Config/Local.xcconfig`, `xcuserdata/`.

### 7.2 Propuesta para la app nueva

| Cambio | Por qué |
|---|---|
| `deploymentTarget.iOS` e `IPHONEOS_DEPLOYMENT_TARGET` → `"26.0"` (o `"26.1"`) | Pedido. Con **26.1** desaparece también la rama `#available(iOS 26.1, *)` de `tabViewBottomAccessory(isEnabled:)` si se usara; el iPhone de Isma va con 26.6 (README) o 27 (según Isma) |
| `SWIFT_VERSION: "6"` (Swift 6.2 del Xcode 26.6); quitar `SWIFT_STRICT_CONCURRENCY` (redundante en modo 6) | Limpieza |
| **Separar el núcleo en un paquete local** (`packages: AceNeoKit: path: Kit` en XcodeGen) o en un objetivo `framework` | Compila en paralelo e incremental, obliga a no mezclar interfaz y núcleo, y permite ajustes de concurrencia distintos por módulo |
| En el módulo de interfaz: `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` y `SWIFT_APPROACHABLE_CONCURRENCY = YES` (lo que trae una plantilla nueva de Xcode 26). **En el núcleo, no** (o con `@concurrent` en `APIClient.enviar`, `DiskCache`, decodificación) | Menos anotaciones en las vistas; en el núcleo, el aislamiento por defecto en `MainActor` volvería `MainActor` los modelos `Codable` y chocaría con los actores `DiskCache`/`CacheImagenes` |
| `OTHER_SWIFT_FLAGS` en Debug: `-Xfrontend -warn-long-expression-type-checking=150 -Xfrontend -warn-long-function-bodies=300` | Ver los cuerpos lentos como aviso ANTES de que la CI los dé como error (§9.2) |
| `TARGETED_DEVICE_FAMILY: "1"` — **propuesta, pendiente de Isma** (§13) | El calco es la web **móvil**; la app actual es universal (`"1,2"`). Con `"1"`, en un iPad la IPA se abre en modo compatibilidad (una ventana de iPhone escalada). Si se mantiene el iPad, hay que calcar las maquetaciones tableta/escritorio/ancha de la web, que describe §13 |
| `ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS: YES` | Símbolos comprobados en compilación para las **imágenes** (`Image(.marca)`) y el único color que queda en el catálogo (`Bg`). Los colores de la interfaz **no** van en el catálogo (§7.5) |
| Fuentes: `Resources/Fonts/MonaSans*.ttf` y `UIAppFonts` en `Info.plist` | La web usa Mona Sans variable (ejes `wght` y `wdth`) |

### 7.3 `Info.plist`

Se queda: `CFBundleDevelopmentRegion es`, nombre `$(ACE_DISPLAY_NAME)` («Ace Neo»), esquema `aceneo` (`$(PRODUCT_BUNDLE_IDENTIFIER).emparejar`), `ITSAppUsesNonExemptEncryption false`, ATS sin `NSAllowsArbitraryLoads` con `NSAllowsLocalNetworking` y excepciones `ts.net` (+subdominios), `100.64.0.0/10`, `fd7a:115c:a1e0::/48`, `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`; `NSCameraUsageDescription` («Ace Neo usa la cámara solo para leer el código QR de emparejamiento que enseña la web de Ace Player Neo.»), `NSLocalNetworkUsageDescription` («Ace Neo se conecta a tu servidor de Ace Player Neo en tu red local (por ejemplo, tu Umbrel) para ver la agenda y reproducir los canales.»), una sola escena, `UIBackgroundModes: audio` (audio en segundo plano y PiP), `UILaunchScreen.UIColorName = Bg`, `arm64`, orientaciones iPhone: vertical + horizontal izquierda/derecha.

Cambios: `UIAppFonts`; si la familia pasa a `"1"`, quitar `UISupportedInterfaceOrientations~ipad` (hoy declara las cuatro orientaciones del iPad); actualizar el comentario «Desde iOS 17…». La IPA no necesita entitlements (el Llavero usa el grupo por defecto que pone la firma).

**Nombre visible (pendiente de Isma)**. Hoy `CFBundleDisplayName = $(ACE_DISPLAY_NAME)` = «Ace Neo» (`Config/AceNeo.xcconfig:8`). Lo que dice la web:

| Dónde | Texto | Fuente |
|---|---|---|
| Marca de la barra superior (≥ 1024 de ancho; entre 768 y 1023 el nombre está oculto y solo queda el icono) | «Ace Player Neo» (17 pt, 800, `wdth` 125), nombre accesible «Ace Player Neo: ir a la agenda» | `app/Nav.tsx:128-133`, `shell.css` `.topbar__brand` |
| `<title>` y `name` del manifiesto | «Ace Player Neo» | `index.html:12`, `manifest.webmanifest` |
| `short_name` del manifiesto | «Ace Neo» | `manifest.webmanifest` |
| Nombre bajo el icono al añadirla a la pantalla de inicio desde Safari en el iPhone | **«Ace Player»** (`apple-mobile-web-app-title`, que Safari prefiere al manifiesto) | `index.html:26` |
| Pantalla de bloqueo (álbum y respaldo de título/artista) | «Ace Player Neo» | `player/media-session.ts` |

Propuesta: `CFBundleDisplayName` = **«Ace Neo»** (el `short_name` oficial; cabe entero bajo el icono) y **todo texto de
marca dentro de la app = «Ace Player Neo»** (barra superior en horizontal/iPad, pantalla de emparejar, pantalla de
bloqueo). Alternativa si se quiere que el iPhone enseñe lo mismo que la web instalada desde Safari: «Ace Player».
Los textos de permisos (`NSCameraUsageDescription`, `NSLocalNetworkUsageDescription`) y los mensajes de la cámara que
dicen «Ace Neo» deben usar el mismo nombre que se elija como visible (Ajustes de iOS lista la app por ese nombre).

### 7.4 Icono (cotejado con la web)

Hoy: `AppIcon.appiconset` de tamaño único 1024 con variantes **claro** (por defecto), **oscuro** y **tintado**, y
`Marca.imageset` (96 pt @2x/@3x, claro y oscuro), generados por `scripts/generar-recursos.mjs` (Chrome + Playwright)
desde `ace-player-neo/docs/diseno/opcion-A/icono-claro.svg`, `icono.svg` e `icono-tintado.svg`.

Comprobado el 25-sep (comparando los ficheros, sin saltos de línea):

| Pieza | Web | iPhone hoy | ¿Igual? |
|---|---|---|---|
| Dibujo base | `apps/web/public/icon.svg` («Ace Player Neo · icono por defecto (oscuro)»: fondo `#0d2439 → #061423`, foco `#5fd9ff` al 34 %, medio campo y círculo central `#f0f6fa` de 22, lente de cristal, triángulo de reproducir) | `docs/diseno/opcion-A/icono.svg` → `AppIcon-oscuro.png` y `marca-oscuro@*x.png` | **Sí: fichero idéntico**. Los PNG de la PWA (`icon-180/192/512/maskable-512`) salen del mismo SVG (`apps/web/scripts/icons.mjs`) |
| Variante clara | **no existe** | `icono-claro.svg` → `AppIcon-claro.png` (**la que ve iOS por defecto**, fondo celeste, trazos oscuros) y `marca-claro@*x.png` | **No** |
| Variante tintada | no existe | `icono-tintado.svg` → `AppIcon-tintado.png` | añadido de iOS 18+ |
| Barra superior (horizontal e iPad) | `<img src="/icon.svg">` 28×28, radio 8, **el mismo en claro y en oscuro** | — (no hay barra) | — |
| Carátula de la pantalla de bloqueo | `icon-192/512.png` (oscuro) | `UIImage(named: "Marca")` (claro u oscuro según apariencia) | **No** en claro |
| Pantalla de inicio de la PWA en el iPhone | `apple-touch-icon` = `icon-180.png` (oscuro) | `AppIcon` claro u oscuro según la apariencia del sistema | **No** en claro |

Qué hacer:
1. `Marca.imageset` → **una sola variante** (la oscura, sin `appearances`) a 28 pt @2x/@3x para la barra superior
   (recortada con `.clipShape(.rect(cornerRadius: 8, style: .circular))`) y a 96 pt para la carátula. Así la marca y la
   carátula son las de la web en los dos temas.
2. `AppIcon`: **decisión de Isma**. Calco estricto = la variante oscura como **por defecto** (sin `appearances`) y
   también como `dark`, con la tintada para el modo tintado; la clara actual desaparece. Si se prefiere el icono claro
   en el tema claro del iPhone (añadido de iOS que la web no puede tener), dejarlo como está y anotarlo como
   diferencia consciente. Recomendación: calco estricto (la PWA que Isma usa hoy enseña el oscuro).
3. Cambiar `generar-recursos.mjs` para que lea **`apps/web/public/icon.svg`** (la fuente de la web) en vez de
   `docs/diseno/opcion-A/icono.svg`, y que la CI compruebe con `--check` que los PNG están al día: si la web cambia
   el icono, el iPhone lo sigue.
4. El icono de iOS no lleva transparencia ni esquinas (iOS aplica la máscara); el SVG ya llena el cuadrado (lo dice
   `icons.mjs`: «el mismo dibujo vale para any y maskable»).
5. Icon Composer (`.icon`, capas para Liquid Glass en iOS 26): no calca la web (añade brillo y refracción); dejarlo
   fuera. XcodeGen lo trataría como un recurso más, pero no está probado en esta CI.

### 7.5 Colores (corregido: en código, no en el catálogo)

Hoy `generar-recursos.mjs` escribe 23 colorsets (`Bg, BgSunk, Surface, Surface2, Line, LineStrong, Text, Text2, Text3,
Accent, OnAccent, AccentInk, AccentEdge, Ok, OkInk, Weak, WeakInk, Fail, FailInk, GlassSolid, Gold, Live, Veil`) +
`AccentColor`, con valores de la tabla `PALCO` del prototipo y, para lo que falta, del bloque hex de `tokens.css`.

~~Generar los colorsets desde el oklch de la web, en Display P3~~ (versión anterior de este apartado: **contradecía a1**).
Lo correcto, alineado con a1 §0.1, §2.6 y §13.2:

- **Colores en código**, un `Color` por token construido con `UIColor { rasgos in rasgos.userInterfaceStyle == .dark ? oscuro : claro }`
  y los **hex sRGB** de las tablas de a1 §2.1–§2.3 (un fichero `Palco/Tokens/Colores.swift` revisable en el diff). Así
  `.preferredColorScheme` y `.environment(\.colorScheme, .dark)` (las «islas oscuras» de a1 §0.2: tarjeta versus,
  cápsulas en cristal, pastilla de competición, todo lo que va sobre el vídeo) cambian el color sin tocar nada más.
- **sRGB, no P3**: las capturas de referencia (Chrome sobre sRGB) pintan los hex; el oro y la tinta oro claro caen
  apenas fuera de sRGB y la diferencia es mínima (a1 §2.6). Con P3 el oro saldría más saturado que en las capturas y la
  comparación píxel a píxel (§8.3.6) daría diferencias en todo lo dorado.
- **En oscuro mandan los hex del bloque `:root[data-scheme='dark']`**, no el OKLCH (especificidad CSS, a1 §0.1).
- **En el catálogo solo quedan** `Bg` (claro `#F3F3F4`, oscuro `#05070A`: lo exige `UILaunchScreen.UIColorName` en
  `Info.plist`, que no admite colores en código) y `AccentColor` (`#FFD60A` en los dos: tinte de lo poco del sistema que
  se usa —alertas, selector de AirPlay—). El resto de colorsets se borran y `generar-recursos.mjs` deja de escribirlos
  (y de tener la tabla `PALCO`).
- Test: comparar los hex de `Colores.swift` con los de `tokens.css` con un script (`--check` en la CI), como ya se hace
  con el catálogo de errores y los vectores.

---

## 8. CI (`.github/workflows/ios.yml`, «iOS (Ace Neo)»)

### 8.1 Disparadores y entradas

- `push` a `rewrite-v2` y `main` (y tags `ios-v*`) y `pull_request`, si cambian `ace-player-neo/apps/ios/**`, `packages/shared/fixtures/**`, `packages/shared/src/**`, `apps/server/src/**`, `apps/server/test/fake-engine/**`, `apps/web/e2e/support/**`, `pnpm-lock.yaml` o el propio workflow. **La rama `rediseno/palco` no está en la lista**: ahí solo corre lanzándola a mano.
- `workflow_dispatch` con:
  - `ipa_aunque_fallen_tests` (booleano, por defecto `false`): archiva y sube la IPA aunque falle algún test.
  - `solo_compilar` (booleano, por defecto `false`): **está en el árbol de trabajo pero SIN COMMITEAR** (`git diff .github/workflows/ios.yml`). Salta ffmpeg, la pila E2E, la espera del simulador, los tests y la IPA; solo compila `build-for-testing`.
- `concurrency: ios-${{ github.ref }}` con `cancel-in-progress: true` (un push nuevo a la misma rama cancela el anterior).
- `runs-on: macos-latest`, `timeout-minutes: 75`, `contents: write` (solo para adjuntar la IPA a la Release).

Cómo lanzarlo:

```sh
# Todo (tests + IPA solo si todo pasa)
gh workflow run ios.yml -R Ismaeloul/umbrel-app-store --ref rediseno/palco
# IPA aunque fallen tests
gh workflow run ios.yml -R Ismaeloul/umbrel-app-store --ref rediseno/palco -f ipa_aunque_fallen_tests=true
# Solo compilar (cuando se commitee el cambio pendiente)
gh workflow run ios.yml -R Ismaeloul/umbrel-app-store --ref rediseno/palco -f solo_compilar=true
# Seguir y descargar
gh run watch <id> -R Ismaeloul/umbrel-app-store
gh run download <id> -R Ismaeloul/umbrel-app-store -n AceNeo-unsigned-0.8.0 -D ipa
gh run download <id> -R Ismaeloul/umbrel-app-store -n AceNeo-capturas -D capturas
```

### 8.2 Pasos y tiempos medidos

| # | Paso | Qué hace | Tiempo típico |
|---|---|---|---|
| 1 | Elegir el Xcode más reciente | `ls /Applications/Xcode_*.app` ordenado por versión → `xcode-select`; imprime SDKs | 2–3 s |
| 2 | XcodeGen (+ ffmpeg en segundo plano) | `brew install xcodegen`; `brew install ffmpeg` con `nohup` y fichero `.fin` con el código de salida | 3–6 s |
| 3 | Node 24 + pnpm (corepack) + caché del almacén | | ~15 s |
| 4 | `pnpm install --frozen-lockfile` | Monorepo (para la pila E2E) | 3–5 s |
| 5 | Comprobar catálogo de errores | `node scripts/generar-catalogo-errores.mjs --check` («ErrorCatalog.swift al día (87 códigos).») | < 1 s |
| 6 | Comprobar vectores | `node scripts/generar-vectores.mjs --check` | < 1 s |
| 7 | `xcodegen generate` | | < 1 s |
| 8 | Arrancar simulador en segundo plano | Python sobre `simctl list -j`: el iPhone de iOS más alto, preferido «Pro» (hoy **iPhone 17 Pro, iOS 26.5**); si no hay, crea «iPhone CI»; `simctl boot` con `nohup` | 4–6 s |
| 9 | Compilar para los tests | `xcodebuild build-for-testing -quiet -derivedDataPath build/DerivedData CURRENT_PROJECT_VERSION=<run>` | **4–8 min** (un error de sintaxis sale a los ~1 min 40 s; uno de type-checker, a los ~5 min 30 s) |
| 10 | Pila E2E | Espera a ffmpeg (hasta 10 min), `node scripts/pila-e2e.mjs` (motor falso 127.0.0.1:6878, engine_control 3001, comprobador en +1, backend en 18790), espera a `GET /native/api/v1/ping` | 5–20 s |
| 11 | Esperar al simulador | `simctl bootstatus -b` | 10–30 s |
| 12 | Tests | `xcodebuild test-without-building … -resultBundlePath build/AceNeo-tests.xcresult -retry-tests-on-failure -test-iterations 2 -quiet` con `TEST_RUNNER_ACE_E2E_PUERTO` | **11–17 min** (un test que falla se repite: 7 fallos contaron 13) |
| 13 | Resumen de los tests (`always`) | `xcresulttool get test-results summary`, detalle de cada fallo en un grupo, `xcresulttool export attachments` y renombrado de capturas por `suggestedHumanReadableName` (limpia `\ / " < > : | * ?`, prefijo `fallo-`, sufijo `-intentoN`) | 5–10 s |
| 14 | Subir capturas / logs de la pila | `AceNeo-capturas`, `AceNeo-pila-e2e-logs` | 5–15 s |
| 15 | Archive sin firmar e IPA | `if: success() || (!cancelled() && inputs.ipa_aunque_fallen_tests)`; `scripts/build-ipa.sh CURRENT_PROJECT_VERSION=<run> [MARKETING_VERSION=<tag>]` → `xcodebuild archive -configuration Release -destination generic/platform=iOS CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""` → `Payload/AceNeo.app` → zip | **2–3 min** |
| 16 | Subir IPA | Artefacto `AceNeo-unsigned-<versión>` | ~3 s |
| 17 | Subir `.xcresult` | `AceNeo-tests-xcresult` | 3–20 s |
| 18 | Release (tags `ios-v*`) | `gh release create/upload --clobber` | — |

Totales: **21 min** en verde (0.7.1), **26–30 min** con UITests en rojo, **2–6 min** si falla la compilación.

### 8.3 Recomendaciones para la CI de la app nueva

1. **Commitear `solo_compilar`** y hacer que en ese modo compile **también Release para dispositivo** (`xcodebuild build -configuration Release -destination generic/platform=iOS CODE_SIGNING_ALLOWED=NO`): el archive en Release (optimización `wholemodule`, sin `#if DEBUG`) puede fallar donde el Debug de simulador no.
2. Añadir un modo **`ipa_sin_tests`** (compilar + archive, sin simulador): la vuelta más corta al iPhone de Isma (~7–10 min).
3. Añadir `rediseno/palco` (o la rama de trabajo) a `on.push.branches` o seguir lanzándola a mano.
4. **Elegir el simulador por tamaño**: las capturas de referencia de la web son **390×844** (y 844×390). El iPhone 17 Pro que elige hoy la CI mide **402×874**: las capturas no se pueden comparar píxel a píxel. Usar un **iPhone 16e** (390×844 pt) si el runner lo tiene, con el Pro de respaldo, o hacer los dos.
5. Mantener `-retry-tests-on-failure -test-iterations 2` para los UITests, pero **no para los unitarios** (un unitario que solo pasa a la segunda es un fallo): partir el paso de tests en dos (`-only-testing:AceNeoTests` y `-only-testing:AceNeoUITests`).
6. Comparación visual: un paso (Python con Pillow o Node con `pixelmatch`) que compare cada `…-390x844-claro.png` del iPhone con el de la web y suba un informe de diferencias como artefacto. Necesita el juego de referencias completo de §8.4 y dos cuidados: (a) la **escala**: la web se capturó con `deviceScaleFactor: 1` (390×844 px) y el simulador da @3x (1170×2532): o se reduce la del iPhone a 1x con el mismo filtro siempre, o (mejor, para comparar texto) se recapturan las referencias de la web con `deviceScaleFactor: 3`; (b) el **reloj y los datos**: web y app con la misma agenda de demostración y la misma hora fijada (Playwright `page.clock.setFixedTime(…)` en la web, argumento de lanzamiento `-AceNeoAhora <ISO>` en el servidor simulado), o nunca coincidirán minutos, «En 25 min», descanso… (a7 §14.5-6).

### 8.4 Capturas de referencia que faltan (juego para §8.3.6)

**Lo que hay** (`design-explorations/capturas/_revision/web-palco/`, generado por `apps/web/scripts/revision-visual.mjs`
en modo demo, Chrome, `locale es-ES`, `timezoneId Europe/Madrid`, `deviceScaleFactor 1`):

| Carpeta | Contenido |
|---|---|
| `final/<vista>/` (22 vistas) | 360×800 oscuro · **390×844 claro y oscuro** (+ «transparencia reducida» en claro y «movimiento reducido» en oscuro) · 768×1024 oscuro · **844×390 solo oscuro** (+ `reproductor-844x390-oscuro-controles-ocultos`) · 1440×900 claro/oscuro · 1920×1080 oscuro |
| `canales/<vista>/` | 1024×1366 oscuro de Canales, Buscar, Pegar y Ajustes (16 vistas) |
| `partido/estados/` | `pestana-partido-390x844-*`, `sin-senal-390x844-*` (en realidad «Conectando» con la fuente 2 comprobando), `marcador-destapado-1440x900-*`, `reconectando-1440x900-*`, `corte-a-negro-1440x900-oscuro` |
| `agenda/pagina-entera/` | página entera 390×844 y 1440×900, claro/oscuro: `agenda`, `-destapado`, `-elegido`, `-primer-uso`, `-viendo`, `-viendo-tapado` |

El claro solo se captura en los tamaños marcados `light: true` en `SIZES` (390×844 y 1440×900); 375×667 y 375×812 no
están en `SIZES`.

**Lo que falta** (todos a 390×844 claro y oscuro salvo que se diga; los que existen en horizontal, también a 844×390
claro y oscuro). Nombre propuesto: `final/estados/<vista>-<estado>/<vista>-<estado>-<ancho>x<alto>-<tema>.png`.

| # | Estado | Cómo se llega en la demo de la web | Espera antes de capturar | Lo describe |
|---|---|---|---|---|
| 1 | `biblioteca-toast-deshacer` | Canales › Favoritos: quitar un favorito (a 390 por el menú de la fila «Quitar de favoritos»; la estrella de la fila solo sale desde 600 de ancho) → toast warn con icono estrella **««DAZN 1» quitado de favoritos»** (`features/library/data.ts:132`) y botón **«Deshacer»** | 400 ms (entrada), antes de los 6 s | a5 §3.9 y toasts (píldora 420, alto 52, radio 26), a2 §8 |
| 2 | `mini-toast-deshacer` | Con un canal sonando, deslizar el mini hacia abajo (> 72 pt) → «Reproducción detenida» + «Deshacer» | 400 ms | a4 §19, a2 §7-8 |
| 3 | `agenda-menu-tarjeta` | Agenda: pulsación larga 500 ms (en Playwright, `click({ button: 'right' })` sobre el centro de la tarjeta: abre el mismo menú en el punto) → «Opciones de {partido}» | 400 ms (aparece en 340 ms) | a3, a1 §10.19 |
| 4 | `reproductor-menu-mas` | Reproductor: despertar los controles (mover/tocar) y pulsar «Más opciones» → menú «Opciones del reproductor» (sin atajos de teclado en táctil) | 400 ms, antes de 3,2 s | a4 §5.6 |
| 5 | `biblioteca-menu-fila` | Canales › Favoritos: «Más acciones para {título}» | 400 ms | a5 (menú de fila) |
| 6 | `partido-menu-cartel` | Partido `demo-1`: pulsación larga / clic derecho en el cartel «Fuente 2» → menú («Copiar hash», «Abrir en la app de AceStream», «Es el canal correcto», «Reportar…») | 400 ms | a4 §12 |
| 7 | `dispositivos-menu-fila` | Ajustes › Dispositivos: pulsación larga en una fila → «Opciones de {nombre}» con «Revocar el acceso» (y el estado armado «Revocar ya») | 400 ms | a6 §8 (ojo: ruta `web`, §10.1) |
| 8 | `partido-hoja-reportar` | Menú del cartel (6) → «Reportar…» → hoja **«Reportar fuente»** (sm) | 700 ms (muelle 520 ms) | a4 §13.2 |
| 9 | `partido-hoja-encontrar` | Partido `demo-2` (varias coincidencias) → «Encontrar canal» → hoja **«Encontrar canal»** (md); y `demo-3` (nada) → la misma hoja con «pegar a mano» | 700 ms | a4 §13.3, §20.15 |
| 10 | `biblioteca-hoja-favorito` | Canales › Recientes: una fila que no es favorita → «Añadir a favoritos» → hoja **«Guardar favorito»**; también desde el inspector del partido («Favorito») | 700 ms | a5 §3.10, a4 §12.8 |
| 11 | `biblioteca-hoja-renombrar` | Menú de fila (5) → «Renombrar» → hoja «Renombrar canal», con el teclado **no** visible (Chrome no lo pinta: en el iPhone habrá que capturarla con el teclado oculto o aceptar la diferencia) | 700 ms | a5 §3.10 |
| 12 | `agenda-vacio-error` | **No se puede en la demo** (la demo responde en JS y `page.route` no la intercepta). En vivo (`--base` contra la pila de pruebas) con `page.route('**/api/v1/football', r => r.fulfill({ status: 503 }))` → «No pudimos cargar la agenda» + «Reintentar» | tras el esqueleto | a3 §10.2 |
| 13 | `agenda-vacio-tuyos` | Demo: «Para ti» en un día con partidos pero ninguno de los tuyos (el script recorre los días hasta ver «Nada de los tuyos este día») → «Editar mis gustos» + «Ver todos» | 500 ms | a3 §10.3 |
| 14 | `agenda-vacio-dia` | Demo: el día con 0 partidos (hoy + 4, «0 partidos» en la tira) → «Sin partidos anunciados» + «Ver el día siguiente» o «Actualizar» | 500 ms | a3 §10.4 |
| 15 | `partido-sin-canales` | **No existe en la demo** (todos los partidos de muestra tienen canal). En vivo con `page.route` que deje `channels: []` en un partido de `GET football` → vacío «Canal por confirmar» · «Este partido todavía no tiene canal anunciado. Si lo encuentras por tu cuenta, pega su Content ID.» · «Pegar hash» | tras resolver | a4 §12.4 |
| 16 | `partido-fuentes-plegadas` | Partido `demo-1`, bajar hasta «Ver 3 más en cola» (plegadas) y otra captura tras pulsarlo («Ocultar las que no dan señal») | que termine el comprobador (~6 pasos × 1,35 s ≈ 8 s) | a4 §12.7 |
| 17 | `partido-ninguna-senal` | Partido `demo-12` (todas sin señal y reintento) → caja **«Ninguna da señal»** (fondo `--fail` 9 %: claro `#FDEEEC`, oscuro `#22191D`) con «Rebuscar» y «Pegar hash», y la espera «Ninguna de las {n} fuentes da señal todavía. Las vuelvo a probar a las {HH:MM}…» | ~10 s | a4 §12.3, §20 |
| 18 | Claro en horizontal | Las 22 vistas de `final/` a **844×390 claro** (hoy solo oscuro) | — | a2 §16 |
| 19 | iPhone pequeños | Las 22 vistas a **375×667** (SE 2.ª/3.ª gen.) y **375×812** (mini, X/XS/11 Pro), claro y oscuro; 667×375 en horizontal (sigue siendo «móvil», a2 §16.6) | — | a2 §16.6 |

Cómo sacarlas (cambios en `apps/web/scripts/revision-visual.mjs`, que no toca la app):
- `SIZES`: añadir `{ width: 375, height: 667, touch: true, light: true }`, `{ width: 375, height: 812, touch: true, light: true }`,
  `{ width: 667, height: 375, touch: true, light: true }` y poner `light: true` en `844×390`.
- `VIEWS`: una entrada por estado con su `prepare` (los pasos de la tabla). Para 12 y 15, un campo `routes` que
  **responda** con estado (hoy `openView` solo sabe editar el JSON: añadir `fulfill({ status })`), y marcarlas
  «solo en vivo».
- Reloj fijo en todas (`await context.clock.install({ time: new Date('2026-09-25T20:30:00+02:00') })`) para que la
  agenda de demostración, los minutos y «En 25 min» sean siempre los mismos; y el mismo instante en el servidor
  simulado de la app (§3.10).
- Opción `--escala 3` (`deviceScaleFactor: 3`) para el juego que se compara con el simulador (§8.3.6).
- Del lado del iPhone, cada estado necesita su UITest con el mismo nombre de captura y los mismos pasos (el servidor
  simulado ya tiene favoritos, listas y sesiones; hay que añadirle los guiones `demo-2`, `demo-3`, `demo-12` de
  `features/sources/demo-data.ts` y un partido sin canales).

---

## 9. Aprendizajes de compilación y del iPhone real (no repetirlos)

1. **Cadenas crudas con `"#` dentro** (`1a3f24c`, primera compilación de la 0.8.0 rota a los 1 min 40 s): `#"{"primary":"#1d3f9a"}"#` se cierra en `"#1` → «'d' is not a valid digit in integer literal», «expected ',' separator». Usar `##"…"##` cuando el texto lleve `"#`, o mejor, sacar el JSON a ficheros o construirlo con `Codable`.
2. **«The compiler is unable to type-check this expression in reasonable time»** (`b838f53`, `RootView.swift:13`): un `body` con `switch` + `.sensoryFeedback(.success, trigger: modelo.fase) { anterior, nueva in anterior == .emparejar && nueva == .lista }` con miembros implícitos. Arreglo: contenido en una propiedad `@ViewBuilder` aparte y tipos escritos (`(anterior: AppModel.Fase, nueva: AppModel.Fase) -> Bool` y `AppModel.Fase.emparejar`). Reglas: cuerpos cortos, subvistas con nombre, nada de cadenas largas de ternarios en modificadores, `let` intermedios para colores/medidas calculados, y los avisos de `-warn-long-expression-type-checking` en Debug.
3. **`GeometryReader` + `.ignoresSafeArea()` da `safeAreaInsets` a cero** (`455264f`): la cabecera del escenario quedó bajo la barra de estado y la isla dinámica; «Minimizar» no se podía tocar y 7 UITests fallaron. Parche actual: si el proxy da cero, leer `keyWindow.safeAreaInsets`. Mejor: ignorar el área segura solo en el fondo (`.background { Color.black.ignoresSafeArea() }`) y dejar el contenido dentro, o usar `.safeAreaPadding`/`onGeometryChange`.
4. **`tabViewBottomAccessory`** (`e944e51`): en iOS 26.0 el accesorio existe siempre y, sin nada sonando, quedaba una **cápsula de cristal vacía** sobre la barra; además el mini no llegaba a aparecer dentro. Desde **iOS 26.1** hay `tabViewBottomAccessory(isEnabled:content:)`: solo mientras hay mini. `@Environment(\.tabViewBottomAccessoryPlacement)` dice si está `.inline` (barra plegada) o expandido. Con `tabBarMinimizeBehavior(.onScrollDown)` la barra se pliega al bajar y los UITests tienen que desplegarla. **Para calcar la web** (barra flotante propia en píldora con 4 pestañas, captura de la agenda) lo previsible es NO usar la barra del sistema: estos problemas desaparecen, pero hay que hacer a mano el hueco inferior (`safeAreaInset(edge: .bottom)`), el mini encima y el comportamiento al teclado.
5. **Bandas vacías arriba en el iPhone real (iOS 26.6) que no salían en el simulador** (`22176d7`, `409e1ed`, `7a1cd64`, `9419f9c`, `a0e9d1d`): `safeAreaInset(edge: .top)` con la tira de días o el selector de la biblioteca → franjas vacías; `safeAreaBar` (iOS 26) difuminaba el título grande; con la app recién emparejada los días «existían» y se podían tocar pero no se pintaban. Solución que quedó: nada propio arriba, todo dentro del contenido que se desplaza, `ViewThatFits` para la tira y **comprobación de píxeles (`sePinta`)** en los UITests.
6. **Cambio de raíz animado** (`5d4d8c5`): el fundido entre emparejar y la app dejaba la tira de días sin pintar. El cambio de `fase` va sin animación.
7. **`strokeBorder` exige `InsettableShape`** (`0d1761c`, `FormaEscudo`).
8. **Aislamiento en Swift 6** (`0d1761c`): cierres `async` de las hojas marcados `@MainActor`; pasar métodos de la vista como cierres (no capturar `self` de una `View` en tareas).
9. `nonisolated(unsafe)` sobra en constantes `Sendable` (avisos en `Canales.swift`).
10. **KVO de AVFoundation en Swift 6**: los cierres heredan el `MainActor` y AVFoundation los llama desde otros hilos → comprobación de aislamiento en tiempo de ejecución. Por eso el motor sondea.
11. **`URLSession.AsyncBytes.lines` se come las líneas vacías** → parser SSE propio.
12. **ATS e IP literales**: desde iOS 17, ATS no deja pasar IP en claro por defecto; `NSExceptionDomains` admite rangos CIDR; una excepción por nombre no cubre la IP ni al revés. Pendiente de comprobar en el iPhone con IP de Tailscale.
13. **UITests**: los controles del vídeo se esconden a los 3,2 s (tocar hasta ver el botón); los arrastres con `press(forDuration:thenDragTo:)`; 1,2 s de espera antes de cada captura; XCUITest da por visible lo que no se pinta.
14. **Nombres de artefacto**: `upload-artifact` no admite `" : < > | * ?` ni saltos de línea.
15. **El simulador no es el iPhone**: PiP, audio con pantalla bloqueada, Centro de Control, AirPlay, llamadas, auriculares, giro, cámara, ATS con IP y las bandas de (5) solo se ven en el aparato. Lista paso a paso en `docs/pruebas-iphone.md` (§0–§15).
16. **Los ejemplos de `@ace/shared` cambian** (agenda con dos días en 0.8.0) y rompen asertos que cuentan cosas: comparar con el ejemplo, no con números fijos.

---

## 10. Huecos entre la app y la web que afectan al calco

### 10.1 Rutas `web` que el iPhone no puede usar

| Pantalla de la web | Ruta | Acceso hoy | Consecuencia |
|---|---|---|---|
| Dispositivos (lista, revocar) | `GET /api/v1/devices`, `DELETE /api/v1/devices/:id` | `web` | 403 `origin_forbidden` desde `/native` |
| Dispositivos (emparejar otro) | `POST /api/v1/pairing` | `web` | Ídem |
| Salud | `GET /api/v1/health`, `GET /api/v1/health/live` | `web` | Ídem |
| Sistema | (health + diagnóstico) | parcial | `GET diagnostics` sí es `any` |
| Ajustes del servidor (política de mismo canal) | `PUT /api/v1/settings` | `web` | Solo lectura (`GET settings` es `any`) |

Opciones: (a) abrir esas rutas a `any` con Bearer en `packages/shared/src/routes.ts` (y revisar el riesgo: un iPhone emparejado podría revocar otros dispositivos o emparejar más); (b) abrir solo lectura (`GET devices`, `GET health`); (c) enseñarlas en el iPhone en modo lectura o con un aviso «Esto se hace desde la web». **Pregunta para Isma.** Por el contrato, además, `ajustes-reproduccion` en la app guarda el modo en local (`UserDefaults`); si la web lo guarda en el servidor, hay que alinearlo.

### 10.2 El QR solo lleva una dirección

`aceneo://pair?u=<URL base>&c=<código>`. Con «la dirección, con el QR para sincronizar», el iPhone solo conoce la que puso la web (la del navegador desde el que se abrió: normalmente la de la LAN o la de Tailscale, no las dos). Para el cambio automático casa/Tailscale sin teclear nada:
- **Servidor**: añadir la otra dirección al enlace (p. ej. `&t=<URL Tailscale>`; `PairingCreateBody.baseUrl` podría pasar a ser una lista) — cambio en `apps/server/src/modules/auth/service.ts`, `packages/shared/src/api/v1/auth.ts` (`pairUri`), la web y el fixture `pairingCreate.json`.
- **App**: `PairingLink` con `servidores: [URL]`, `ServerConfig` rellenando los dos huecos por `ServerVia.clasificar`, tests en `EmparejamientoTests`.
- Alternativa sin tocar el QR: que `bootstrap` devuelva las direcciones conocidas del servidor y la app guarde la otra tras emparejar.

### 10.3 Otras diferencias a tener en cuenta

- La web reproduce con mpegts.js/hls.js; el iPhone con AVPlayer sobre el remux HLS fMP4 (`client=ios`): el retraso respecto al directo y los mensajes de la línea de estado no serán idénticos (modos 12/8/4 s).
- La web no tiene pantalla de emparejar (la app sí: la conserva como añadido, con los textos de §3.3.4).
- Los avisos (toasts) van abajo en la web y arriba en la app actual.
- La web tiene una barra inferior propia en píldora; la app actual, `TabView` del sistema.

---

## 11. Modernización para iOS 26 como mínimo

### 11.1 Ramas `#available` / `#if compiler` que sobran (todas en la interfaz que se borra)

| Fichero | Rama | Con iOS 26 mínimo |
|---|---|---|
| `App/RootView.swift` | `if #available(iOS 18.0, *)` `Tab` + `role: .search` / si no `.tabItem` | Sobra el `else` |
| `App/RootView.swift` | `#if compiler(>=6.2.1)` + `#available(iOS 26.1, *)` `tabViewBottomAccessory(isEnabled:)` / `26.0` sin `isEnabled` / si no, nada | Sobran `#if compiler` (Xcode 26 = Swift ≥ 6.2) y la rama 26.0 si el mínimo es 26.1 |
| `Player/ReproductorVistas.swift` | `#if compiler(>=6.2)` `MiniAccesorio` (`@available(iOS 26.0, *)`); `ReservaMini` (mini como `safeAreaInset` en 17-25) | Sobran |
| `Design/Tema.swift` | `Cristal`/`CristalSobreVideo`: `glassEffect` en 26, materiales en 17-25, opaco con «Reducir transparencia» | Sobra la rama de materiales (salvo que se elija material a propósito para parecerse al `backdrop-filter` de la web) |
| `Design/Palco.swift` | `BotonOro` con cristal en 26 | Sobra |
| `Design/Componentes.swift` | `FondoCristalCircular` (26); `origenZoom`/`destinoZoom` (`matchedTransitionSource`/`.navigationTransition(.zoom)`, iOS 18) | Sobran |
| `Features/Library/CanalesView.swift` | `BuscableSoloEnIOS17` (buscador en Canales solo en 17) | Sobra |
| `Config/Info.plist`, `README.md` | Textos «iOS 17 como mínimo», ATS «desde iOS 17» | Actualizar |
| `scripts/generar-recursos.mjs` | «Con iOS 17 como mínimo, Xcode solo pide 1024» | Actualizar comentario |

El núcleo no tiene ninguna. Ninguna API del núcleo exige más de iOS 16 (`requestGeometryUpdate`, `OSAllocatedUnfairLock`), iOS 15 (`URLSession.bytes`, `AVPictureInPictureController`) o iOS 17 (`@Observable`).

### 11.2 Swift 6 / 6.2: lista de puntos del núcleo

| Punto | Dónde | Estado | Qué hacer |
|---|---|---|---|
| `nonisolated(unsafe)` sobre `NSRegularExpression` | `Canales.swift` | 6 avisos | Quitar |
| `@unchecked Sendable` | `MemoriaImagenes` (NSCache), `CompletarRestauracion` (cierre de AVKit), `CajaSesion` (AVCaptureSession) | Justificados | Mantener (documentados) |
| `nonisolated` + `MainActor.assumeIsolated` en delegados | `DelegadoPiP`, `QRScannerController`, observadores de `NotificationCenter` y `MPRemoteCommandCenter` | Correcto (se llaman en el hilo principal) | Swift 6.2: conformidades aisladas `@MainActor Protocolo` para los delegados |
| `unowned let app: AppModel` | `CentroPartidoModelo` | Riesgo de cuelgue si el `AppModel` muere antes (tests) | Protocolo `ContextoCentro` o `weak` |
| Sondeo en lugar de KVO | `MotorAVPlayer` | Correcto | Opcional: observación de AVFoundation de iOS 26 (verificar) |
| Decodificación en funciones `nonisolated async` | `APIClient.enviar`, `ServerResolver.ping`, `CacheImagenes` | Hoy en el ejecutor global | Si se activa `NonisolatedNonsendingByDefault`: `@concurrent` |
| Estado de presentación en el núcleo | `Reproductor.expandido/superficiesGrandes/vista`, `AppModel.escenario…` | Mezcla | Sacar a la presentación |
| Tests que llaman a `@MainActor` desde contexto no aislado | `AgendaYBibliotecaTests.swift:179-181` | 3 avisos | Clases de test `@MainActor` |
| SSE reconecta sin `Last-Event-ID` al volver de segundo plano | `AppModel.arrancarTiempoReal` | Funciona (llega `resync` y `bootstrap`), pero no es la web | **Obligatorio**: guardar el último id y reanudar con él (§3.11.2) |
| `Task.immediate` (Swift 6.2) | Acciones de botones que empiezan con trabajo síncrono | — | Útil en la interfaz nueva para que la háptica y el cambio de estado no esperen al siguiente ciclo |
| `Observations { … }` (iOS 26) | `ControlesSistema` hoy recibe `sistema?.cambio(self)` a mano | Funciona | Opcional: observar el `Reproductor` con `Observations` |

---

## 12. Traducción a SwiftUI (iOS 26): cómo montar la app nueva sobre este núcleo

### 12.1 Módulos

```
AceNeoKit (paquete local o framework, sin SwiftUI salvo VistaVideo/BotonAirPlay)
 ├─ Modelos, Red (API, APIClient, ServerResolver, SSE), Auth (Llavero, Servidores, PairingService)
 ├─ Caché (DiskCache, CacheImagenes)
 ├─ Dominio (ParaTi, Canales) + ReglasWeb (ports nuevos de teams.ts, color.ts, cards.ts, domain.ts,
 │   sources/model.ts, preferences/model.ts, where-playing, library…)  ← todo con vectores del TS
 ├─ Reproducción (MotorVideo, MotorAVPlayer, MaquinaConexion, Directo, ServicioReproduccion, Reproductor,
 │   ControlesSistema, SuperficieVideo + GestorPiP, CentroPartidoModelo, ReglasFuentes)
 └─ Debug (ServidorSimulado con los datos de demostración de la web, MotorSimulado)
AceNeo (app, SwiftUI, aislamiento por defecto MainActor)
 ├─ Tema (tokens de la web: colores, Mona Sans wght/wdth, radios, sombras, duraciones, curvas)
 ├─ Presentación (pestaña, escenario/partido, mini, hojas, avisos) ← copia de stage-slot.ts / screen.ts de la web
 ├─ Pantallas (Agenda, Partido, Reproductor, Biblioteca, Buscar, Pegar, Ajustes…, Dispositivos, Salud,
 │   Preferencias, Ayuda, Sistema) + Emparejar (añadido)
 └─ Componentes (tarjeta versus, cápsulas, chips, filas, barra inferior en píldora…)
```

### 12.2 Piezas de SwiftUI de iOS 26 que encajan

> Corregida el 25-sep: la primera versión de esta tabla contradecía a1–a5 en cinco puntos (cifras con
> `.contentTransition(.numericText())`, tarjeta versus «en diagonal» con `MeshGradient`, hojas con `.sheet`,
> `TabView` con la barra oculta y Dynamic Type con `UIFontMetrics`). Mandan a1 §3.5, §10.15, §10.18–§10.19, §13 y
> a2 §21; las filas de abajo ya están alineadas con ellos.

| Necesidad de la web | Pieza nativa | Nota |
|---|---|---|
| Barra inferior propia en píldora (Agenda · Canales · Buscar · Ajustes) | **Sin `TabView`** (corregido: la versión anterior proponía un `TabView` con la barra oculta, que contradice a2 §21). `ZStack` raíz con las pestañas **visitadas** montadas a la vez (`ForEach(visitadas) { … .opacity(activa ? 1 : 0).allowsHitTesting(activa).accessibilityHidden(!activa) }`), cada una con su `ScrollView` (conserva estado y desplazamiento, como `<Activity>` de la web); la barra dibujada a mano encima, flotante a 12 de los lados y `safeB + 10` de abajo, alto 64, radio 24, píldora con `offset(x: i·ancho)` y muelle estándar (a2 §4, §21.1–§21.2) | `TabView` trae la barra Liquid Glass, su propio ciclo de vida de pestañas y el plegado de iOS 26 (§9.4) |
| Tarjeta versus: **dos mitades verticales** en rejilla de 2 columnas (corregido: no es diagonal ni `MeshGradient`) | `HStack(spacing: 0)` de dos `Rectangle` a partes iguales; cada mitad = `LinearGradient` a **160°** (local: color → mezcla al 78 % con `#0a0d12`; visitante: mezcla al 88 % con blanco → color) + `EllipticalGradient` blanco (local 14 % desde la esquina superior izquierda, visitante 10 % desde la inferior derecha, `90% 100%`, se apaga al 60 %); encima el velo (lineal 180° negro .42/.05/.05/.82 + radial 60 %×55 % negro .28) y las capas de a1 §10.15 | Colores de `lib/teams.ts` + `lib/color.ts` (ΔE OKLab, §3.9.6); ángulos CSS convertidos a `UnitPoint` (a1 §13.9-8) |
| `backdrop-filter: blur()` | `.background(.ultraThinMaterial)` o `UIVisualEffectView` envuelto; **no** `glassEffect` (refracta y se ve distinto) | Riesgo de diferencia visual |
| Tipografía Mona Sans variable | `UIFont(descriptor:)` con `UIFontDescriptor.AttributeName("NSCTFontVariationAttribute")` = `[0x77676874 /*wght*/: peso, 0x77647468 /*wdth*/: anchura]` → `Font(uiFont)`; `Font.custom` no expone `wdth`; fijar **siempre** los dos ejes (el fichero variable pesa 200 por defecto, a1 §0.5) | **Tamaños fijos** como la web (corregido: no `UIFontMetrics`). La web no sigue el tamaño de texto de iOS; escalar con `UIFontMetrics` rompería el calco (a1 §3.7-6, a2 §21.3). Fijar `.dynamicTypeSize(.large)` en la raíz salvo que Isma decida escalar (pregunta abierta en a3 §17-3) |
| Curvas CSS `cubic-bezier(a,b,c,d)` y duraciones | `Animation.timingCurve(a, b, c, d, duration:)` | Mapear una a una los tokens de movimiento de la web |
| `@keyframes` (punto de directo que late, giro del anillo «Comprobando») | `phaseAnimator`, `keyframeAnimator`, `TimelineView(.animation)` | Respetar `accessibilityReduceMotion` = `prefers-reduced-motion` |
| Transición del mini al reproductor | `matchedGeometryEffect` entre huecos + **la misma capa de vídeo** que se mueve (`VistaVideo` con prioridades) | No crear una segunda `AVPlayerLayer` |
| Arrastres (mini abajo = detener, reproductor abajo = minimizar, lateral = fuente) | `DragGesture(minimumDistance:)` con `predictedEndTranslation`; `UIGestureRecognizerRepresentable` (iOS 18) si hay conflicto con el `ScrollView` | Números de la web (`DISMISS_PX = 72`…) en funciones puras con tests |
| Háptica | `.sensoryFeedback(_:trigger:)` con tipos explícitos | §9.2 |
| Listas y desplazamiento | `ScrollView` + `LazyVStack` (no `List`, que impone márgenes y separadores del sistema); `onScrollGeometryChange`, `scrollPosition` (iOS 18) | Calco exacto de márgenes |
| Hojas (reportar, encontrar canal, pegar, guardar favorito, renombrar, gustos, atajos) | **Hoja propia** en la raíz (capa z 80; corregido: no `.sheet`): velo `--scrim` que entra en 340 ms, panel `UnevenRoundedRectangle(topLeading: 24, topTrailing: 24)` con fondo opaco `--glass-solid`, asa 40×5 que cierra al soltar tras ≥ 72 pt o ≥ 0,45 pt/ms, entrada `translateY(100 %) → 0` con muelle estándar 520 ms; en horizontal (≥ 768 de ancho) diálogo centrado de 420/560/760 con radio 24 (a1 §10.18, §13.7; a2 §9, §16.4) | La `.sheet` de iOS 26 es cristal flotante con márgenes en tamaños parciales (a1 §13.9-4). Solo como plan B, con `.presentationBackground`, `.presentationCornerRadius(24)`, `.presentationDragIndicator(.hidden)` y asa propia |
| Menús («Más opciones», tarjeta, fila de canal, cartel de fuente, dispositivo) | **Menú propio** (capa z 90) alineado a la derecha del botón y 6 pt por debajo, o en el punto de la pulsación larga (500 ms, tolerancia 8 pt), caja de cristal denso radio 18, filas de 44; aparece con opacidad 340 ms + escala 0,96 → 1 (a1 §10.19) | `Menu`/`.contextMenu` nativos: cristal del sistema y vista previa levantada que la web no tiene |
| Números que cambian (marcador, minuto, hora, contadores) | **`Num`**: cada cifra en una celda fija de **0,49 em** (condensada, `wdth 75`/`wght 780`) o 0,645 em (texto normal), centrada; separadores a su ancho; **nada se mueve** al cambiar (corregido: no `.contentTransition(.numericText())` ni `.monospacedDigit()`, que activa `tnum` y pinta el cero con barra; a1 §0.4, §3.5, §13.3). Única animación: el **giro en paleta** del marcador al destaparlo o al cambiar una cifra (gol): `rotation3DEffect(.degrees(-90 → 0), axis: (1, 0, 0), perspective: …)` equivalente a `perspective(240px) rotateX(-90deg)` + opacidad 0 → 1, con el muelle héroe (800 ms en la web; `Movimiento.heroe` de a1 §13.5); con movimiento reducido, fundido (a3 §8.3, a4 §23.1) | La primera vez que se pinta, sin destapar, no gira |
| Área segura | Contenido dentro; fondo con `.ignoresSafeArea()` | §9.3 |
| Horizontal 844×390 | `@Environment(\.verticalSizeClass)` / `onGeometryChange`; todas las pantallas, no solo el vídeo | La app actual solo pone el vídeo a pantalla completa en horizontal |
| Toasts abajo con acción | `Avisos` nuevo (port de `notices/*`, §3.11.4) + `VStack(spacing: 8)` en un `.overlay(alignment: .bottom)` de la raíz; entrada opacidad + `offset(y: 12)` + escala 0,98, salida fundido 320 ms; ocultos en inmersivo | Posición y fórmulas de la web (a2 §8) |
| Apariencia Sistema/Claro/Oscuro | `@AppStorage("aceneo-tema")` (clave de la web) + `.preferredColorScheme` | Claves `aceneo-tema`, `aceneo-transparencia`, `aceneo-pb`, `aceneo-panel` y migración desde `es.ismaeloul.aceplayerneo.apariencia`/`.modo` de la 0.8.0: a1 §13.10 |
| Accesibilidad | `accessibilityIdentifier` = los `data-testid` de la web; etiquetas en español | |

### 12.3 Riesgos de que no quede idéntica

1. **Tamaño de pantalla**: las referencias son 390×844; el iPhone de Isma y el simulador de la CI (402×874) no. Probar en iPhone 16e (390×844) para comparar y decidir si el calco escala o reparte el espacio sobrante como la web (que es fluida).
2. **Renderizado de texto**: Core Text y Chrome no pintan igual (hinting, `letter-spacing`, interlineado de `line-height`); Mona Sans variable necesita la descripción por ejes. Diferencias de 1–2 px en saltos de línea pueden cambiar la altura de las tarjetas.
3. **Colores**: la web define oklch con `light-dark()`, pero en oscuro mandan los hex (especificidad, a1 §0.1) y las capturas de referencia están en sRGB. Se usan los **hex sRGB en código** (§7.5): el oro de un iPhone P3 con Safari se vería un pelo más saturado que en la app, pero la app coincidirá con las capturas. Riesgo residual: que alguien vuelva a generar colorsets o use los OKLCH oscuros.
4. **Desenfoques y cristal**: `backdrop-filter` ≠ materiales de iOS ≠ Liquid Glass.
5. **Barra inferior y teclado**: sin la barra del sistema hay que resolver a mano el teclado, el plegado y el mini.
6. **Gestos**: la web tiene umbrales pensados para puntero/táctil del navegador; en iOS conviven con el gesto de volver, el Centro de Control y la barra de inicio (`defersSystemGestures(on: .bottom)` donde haga falta).
7. **Vídeo**: AVPlayer en HLS fMP4 arranca y recupera distinto que mpegts.js; los estados («Conectando», «Cargando»…) y los tiempos no coincidirán exactamente.
8. **Pantallas que dependen de rutas `web`** (§10.1): sin cambio del servidor, Dispositivos/Salud/Sistema no pueden ser idénticas.
9. **Capturas sin vídeo**: el `MotorSimulado` no da imagen; para comparar la pantalla del reproductor con la de la web hace falta un vídeo local (p. ej. un HLS de prueba incluido solo en Debug) o aceptar la caja negra.
10. **iOS 27**: Isma habla de iOS 27; la CI compila con el SDK 26.5 y prueba en 26.5. Lo que cambie iOS 27 en la apariencia (barras, cristal, tipografía del sistema) solo se verá en el iPhone. Cuanto más propio sea el dibujo (sin controles del sistema), menos le afectará.
11. **Type-checker**: pantallas grandes copiadas de TSX tienden a cuerpos enormes; partir en subvistas desde el principio (§9.2) o la CI tardará minutos en decir que no compila.

### 12.4 Orden propuesto para la migración

1. Mover el núcleo a `AceNeoKit` sin cambiar código (compila y pasan los ~150 unitarios que se quedan).
2. Partir `AppModel` (núcleo/presentación), sacar el estado de presentación de `Reproductor`, protocolo para `CentroPartidoModelo`.
3. Portar las reglas de la web que faltan (teams/color/cards/domain/…) con vectores en `generar-vectores.mjs`.
4. Aplicar los cambios del núcleo de §3.11 (plazos, SSE, sondeos, avisos, visor, pantalla de bloqueo, primer fotograma, mensajes) con sus tests.
5. Colores en código (§7.5; borrar los colorsets salvo `Bg` y `AccentColor`), icono y marca desde `apps/web/public/icon.svg` (§7.4), Mona Sans y el tema.
6. Borrar la interfaz vieja (§4) y montar la nueva pantalla a pantalla, con UITests + capturas con los nombres de la web.
7. Completar el juego de capturas de referencia de la web (§8.4) antes de empezar a comparar.
8. CI: `solo_compilar` commiteado (con Release), `ipa_sin_tests`, simulador 390×844, comparación de capturas.
9. Servidor (si Isma lo aprueba): QR con dos direcciones y rutas de Dispositivos/Salud.
10. iPad: solo si Isma decide mantenerlo (§13), después de que el iPhone esté calcado.

---

## 13. iPad: decisión pendiente y, si se mantiene, sus maquetaciones

### 13.1 Situación

- La app actual es **universal**: `TARGETED_DEVICE_FAMILY "1,2"` (`project.yml`) y `UISupportedInterfaceOrientations~ipad`
  con las cuatro orientaciones (`Config/Info.plist:113-119`); ninguna vista mira el tipo de aparato.
- §7.2 proponía `"1"`: es una **propuesta**, no una decisión. Isma pidió «una ipa … para app en iPhone», pero no ha
  dicho nada del iPad.
- La web **sí** tiene maquetaciones para pantallas grandes, decididas **por ancho de ventana** (`lib/media.ts`,
  `shell.css`): móvil < 768 · **tableta 768–1023** · **escritorio 1024–1279** · **ancha ≥ 1280**. Ningún documento de
  la fase 3 las describe (a1–a7 se centran en 390×844 y 844×390); este apartado las resume desde el código y las
  capturas `final/*/…-768x1024-oscuro.png` y `canales/*/…-1024x1366-oscuro.png`.

### 13.2 Opciones

| Opción | Qué ve Isma en un iPad | Trabajo | Recomendación |
|---|---|---|---|
| **A. Solo iPhone** (`"1"`, quitar `~ipad`) | La IPA se instala y abre en **modo compatibilidad**: una ventana con la proporción del iPhone, escalada | ninguno | **Sí, para la primera IPA** |
| B. Universal con la maquetación móvil estirada | Barra inferior de 64 a lo ancho, tarjetas enormes: ni calco ni nativo | poco | No |
| C. Universal calcando la web por anchos | Lo mismo que la web en el navegador del iPad (§13.3–§13.9) | +30–40 % de interfaz: armazón con barra superior, panel lateral, columna de agenda, ficha de canal, índice de Ajustes, hojas como diálogo, luz ambiental… y su juego de capturas | Después del iPhone, si Isma lo quiere |

**Pregunta para Isma**: ¿A (solo iPhone) o C (iPad calcado más adelante)?

### 13.3 Qué maquetación de la web le toca a cada iPad

La app debe decidir **por el ancho de su ventana** (en iPadOS 26 las ventanas se redimensionan libremente), nunca por el
modelo: `ShellLayout.kind = ancho < 768 ? .movil : ancho < 1024 ? .tableta : ancho < 1280 ? .escritorio : .ancha`
(a2 §21.1 ya lo prevé). «Móvil en horizontal» (inmersivo) exige alto ≤ 540: en un iPad a pantalla completa no ocurre
nunca, pero sí en una ventana baja.

| iPad (pt, pantalla completa) | Vertical | Horizontal |
|---|---|---|
| iPad mini (A17 Pro) 744×1133 | **móvil** (744 < 768: barra inferior, como el iPhone) | escritorio (1133) |
| iPad (A16) y iPad Air 11″ 820×1180 | tableta | escritorio (1180) |
| iPad Pro 11″ (M4) 834×1210 | tableta | escritorio (1210) |
| iPad Air 13″ 1024×1366 | escritorio | **ancha** (1366) |
| iPad Pro 13″ (M4) 1032×1376 | escritorio | **ancha** (1376) |

Otras dos diferencias de iPad: con teclado, ratón o trackpad, `(hover: hover) and (pointer: fine)` se vuelve cierto
(estados `:hover`, flechas del carrusel, atajos de teclado y su ayuda «?»); y en ≥ 1024 `--gutter` pasa a **24**,
`--fs-label` a 12 y `--fs-caption` a 13 (`tokens.css:272-278`).

### 13.4 Armazón (`app/Shell.tsx`, `app/shell.css`, `app/layout.tsx`)

| Pieza | Tableta 768–1023 | Escritorio 1024–1279 | Ancha ≥ 1280 |
|---|---|---|---|
| Rejilla de `.app` | columnas `auto · minmax(0,1fr) · auto`, filas `auto · minmax(0,1fr)`, áreas `top top top` / `column main aside` | igual | igual |
| Barra superior | pegada arriba, alto **64 + safeT**, cristal `--glass` + desenfoque 30 / saturación 1,5; al bajar > 32 pt aparece la capa `--glass-dense` con filete inferior `--line-soft` (opacidad, 340 ms). Detalle en a2 §16.1 (allí a 844×390, que es «tableta») | igual | igual |
| Marca | icono **28×28 radio 8** (`/icon.svg`, el mismo en claro y oscuro); **nombre oculto** (solo para lectores) | icono + **«Ace Player Neo»** 17 pt, `wght` 800, `wdth` 125, tracking −0,02 em, separación 10 | igual |
| Destinos | 4 celdas de **104**, relleno 0 8 | 4 celdas de **116**, relleno 0 12 | igual |
| Destino (común) | alto 44, icono 20 + texto 13 pt `wght` 620 `wdth` 88, separación 7; activo `--accent-ink`, inactivo `--text-2`; píldora `--accent-wash` de 44 que se desliza (`translateX`, muelle estándar 520 ms) | | |
| Derecha | indicador del motor con texto («Motor en línea») + «?» «Atajos de teclado» 44×44 | igual | igual |
| Barra inferior y velo | no hay | no hay | no hay |
| Contenido | relleno lateral 16 (+ safeR a la derecha), abajo `safeB + 32` (con mini `safeB + 72 + 48`) | lateral **24** | 24 |
| Cabecera de vista | título **44** (interlínea 48,4), relleno superior 24; el motor no va en la cabecera | igual | igual |
| Panel lateral `.app-aside` | no hay | **sí** en Canales y Partido (si está desplegado): ancho **340** (380 desde 1600), pegado bajo la barra, alto `100dvh − 64 − safeT`, desplazamiento propio, relleno `20 16+safeR (safeB+20) 16`, filete izquierdo 1 `--line-soft`. Se pliega con el botón `panel` («Plegar el panel lateral» / «Mostrar el panel lateral»); se recuerda en `localStorage['aceneo-panel']` (`abierto` por defecto) | igual |
| Columna `.app-column` | no hay | no hay | **sí, solo en el partido**: ancho **300** (340 desde 1600), mismo pegado y desplazamiento, relleno izquierdo `16 + safeL`, filete derecho |
| Mini | **tarjeta abajo a la izquierda**: `safeL + 16`, `safeB + 16`, ancho `min(440, ancho − 32)`, alto 72; «Dónde se está reproduciendo» (tele) siempre visible | igual | igual |
| Toasts | abajo a la derecha: `safeR + 20`, `safeB + 20`, ancho `min(420, ancho − 40)`; entre 768 y 919 con mini, a `safeB + 72 + 32` | igual (sin la subida) | igual |
| Hojas | **diálogo centrado** (sm 420, md 560, lg 760 como máximo), radio 24 en las 4 esquinas, entra con opacidad 340 ms + `translateY(12) scale(0,98)` → reposo 520 ms; con alto > 540 se desplaza solo el cuerpo (medido: «¿Qué fútbol te mueve?» a 768×1024 ocupa x 24 → 744) | igual | igual |
| Menús | los mismos (a1 §10.19) | | |

### 13.5 Agenda (`features/agenda/index.tsx`, `Stage.tsx`, `agenda.css`)

- **Tableta** (captura `agenda-768x1024-oscuro`): como el móvil, con estos cambios: tarjetas de las filas de **300**
  (en vez de 240); héroe `xl` con radio 24, nombres 30, sin escalar los escudos (0,8 solo < 768) y velo propio (lineal
  180° .36/0/0/.5 + radial 64 %×80 % en la esquina inferior izquierda .6 + radial 40 %×60 % .22); bajo «Agenda», la
  frase **«Hoy · Viernes, 25 de septiembre»**; la tira de días **no va a sangre**; títulos de competición a **22**;
  la tarjeta de primer uso en 3 columnas con relleno 24. Sigue el deslizamiento lateral para cambiar de día.
- **Escritorio** (1024–1279; no hay captura a 1024×1366 de la agenda, sí a 1280×800 y 1440×900 que son «ancha»):
  - Héroe `xl` con relleno 24, nombres **44**, escudos al 44 % del alto y escalados **×1,4**.
  - Tira de días en **fichas** (`tiles`: «HOY / 25 / 5 partidos»).
  - Tocar una tarjeta la **elige** (la primera vez) y la vuelve a tocar / doble toque / Intro la **abre**
    (`interaction: 'select'`, `MatchRow.tsx:268-303`); nombre accesible «{partido}, {estado}».
  - Cuerpo en dos columnas cuando hay panel: `minmax(0,1fr) · minmax(340, 400)`, separación 24. Panel `.agenda__side`
    pegado a `64 + safeT + 16`, alto máx. `100dvh − 64 − safeT − 32`, separación 20, desplazamiento propio.
  - Panel del partido elegido (`AgendaStage`), si no es el del héroe: tarjeta `surface` radio 24 con relleno
    `10 10 20` y la luz de los dos clubes arriba (radiales 60 %×70 % en 10 %/90 %, al 22 % y 18 %); dentro, tarjeta
    versus `lg` (con la cápsula «Marcador» abajo a la derecha si hay marcador), «SEÑAL» (cápsula `md` + resumen; si no:
    «El partido ha terminado.», «Sin canal anunciado todavía.» o «Se comprueba cerca de la hora del partido.»),
    «DÓNDE SE EMITE» (chips continuos = en tu biblioteca, discontinuos = se buscará; «Canal por confirmar») y el botón
    primario de alto **52** y 17 pt: «Ver canal» / «Buscar canal» / «Volver al vídeo» / «Canal por confirmar»
    (deshabilitado).
  - «LUEGO»: rejilla `repeat(auto-fill, minmax(168, 1fr))`, separación 10, tarjetas compactas 3:2.
- **Ancha**: todo lo anterior con panel `minmax(380, 440)` y separación 32; barra de días y filtro en una línea
  (`1fr auto`, separación 24) y, encima del panel, la **tira «En directo»** (`LiveStrip`: cápsulas de 44 con dos
  escudos de 18, siglas, «vs» o el marcador si está destapado, y el minuto o «Desc.»; se desplaza a mano con máscara de
  28 pt al final).

### 13.6 Partido y canal (`features/match-center/*`, `player/player.css`)

- **Tableta** (captura `partido-768x1024-oscuro`): el escenario **deja de estar pegado** arriba (`position: relative`,
  relleno 20 arriba y 8 abajo); el vídeo va centrado con ancho `min(100 %, 70 % del alto × 16/9)`, **radio 24** y
  sombra `0 0 0 1 #000 .3` + `0 20 60 #000 .6`; el bloque del partido (`.mc`) con el mismo ancho máximo, centrado.
  Controles con relleno 12 y la variante «tableta» (la misma que en 844×390: cápsula del canal en lugar de ⌄,
  «Detener» visible, marcador ancho; a4 §18). Cápsula de estado con relleno `0 12 12` y subida −64 sobre los
  controles. Pestañas bajo el vídeo en variante `list`; carteles de fuentes en rejilla `auto-fill, minmax(160, 1fr)`
  (tres por fila a 768).
- **Luz ambiental** (solo ≥ 768 y nunca en inmersivo; solo si el canal trae colores de club): `::before` detrás del
  vídeo con márgenes `−56 −min(32, gutter) −72`; dos radiales 46 %×62 % en 16 % y 84 % (a 46 % de alto) con los
  colores de club al **22 %** mezclados en OKLab hasta transparente al 74 %; `blur(24)`; «respira» 9 s `ease-in-out`
  en alternancia: opacidad 0,72 ↔ 1 y escala 0,98 ↔ 1,02. Con movimiento reducido, quieta. En SwiftUI: dos
  `EllipticalGradient` en un `ZStack` detrás del vídeo, `.blur(radius: 24)`, `phaseAnimator` de 9 s.
- **Escritorio**: las pestañas se van al **panel lateral** (`MatchAside`: «Fuentes · Partido · Datos técnicos» o
  «Fuentes · Canal · Datos técnicos», variante `rack` con rótulos de 12 pt y relleno 3, y el botón «Plegar el panel
  lateral»); bajo el vídeo solo queda la cabecera. Plegado: las pestañas vuelven bajo el vídeo en variante `rack`
  con «Mostrar el panel lateral».
- **Ancha** (captura `partido-1440x900-oscuro`): además, la **columna de agenda** a la izquierda (`column.tsx`):
  cabecera «Agenda» 22 pt `wght` 800 `wdth` 125, navegación de día con `chev-l`/`chev-r` («Día anterior» /
  «Día siguiente») y el día en medio («Hoy 25», mínimo 64, 13 pt 700), segmentado a lo ancho «Para ti» / «Todos» (sin
  contadores), lista compacta por competición (tarjetas 2:1, escudos al 46 %), el partido abierto marcado; tocar otro
  lo abre (háptica ligera; sin canales, toast info «El canal todavía no está anunciado»); vacíos «No pudimos cargar la
  agenda.», «Nada de los tuyos este día.», «Sin partidos anunciados este día.»; cargando, 4 esqueletos de 150.
- En el partido nunca hay mini (como en el móvil).

### 13.7 Canales (`features/library/*`)

- **Tableta**: pestañas «Favoritos · Recientes · Listas» **con icono**; sin deslizar entre pestañas (solo en móvil,
  `LibraryView.tsx:224`); «Emitiendo ahora» con relleno 16 a sangre; la estrella de la fila visible (≥ 600).
- **Escritorio** (captura `biblioteca-favoritos-1024x1366-oscuro`): **ficha del canal** en el panel lateral
  (`ChannelDetail.tsx`): tarjeta `surface` radio 24, relleno 20, separación 16; cabecera con tesela de 54 y nombre
  22 pt (800, `wdth` 125, interlínea 1,12), origen 13 pt «En tus favoritos» / «En tus recientes» / «En tu lista activa»
  (+ « · categoría»), cápsula oro «En pantalla» si suena; «Ver canal» a todo lo ancho y debajo favorito, «Copiar enlace
  acestream://» y «Más acciones para {canal}»; «AHORA» (anillo con el minuto y los dos equipos con sus goles, tapados
  si es lo que estás viendo) o «Sin partido anunciado ahora mismo.»; «DESPUÉS» con hora y partido; «Hash a1b2c3d4…12345678»
  en monoespaciada con «Copiar hash». Sin canal elegido: «Elige un canal de la lista para ver qué da hoy, sus acciones
  y su hash.». Con la ficha a la vista, **tocar una fila la elige** (fondo `surface-2` y filo oro de 3 a la izquierda,
  a5 línea 569) y «Ver canal» la reproduce; botón de cabecera `panel` «Ocultar la ficha del canal» / «Enseñar la ficha
  del canal» (pulsado cuando se ve).

### 13.8 Ajustes y el resto

- **Ajustes** (captura `ajustes-1024x1366-oscuro`): desde 1024, índice en **columna** de 280 a la izquierda (separación
  32), pegado a `64 + safeT + 16`; cada entrada de alto mín. 58, relleno 8 12, radio 14, icono cuadrado 36 (radio 10,
  `surface`; el activo en `--accent`), título 15 pt y la pista en 12 pt `--text-3` («Modo y un solo dispositivo»…);
  la activa con fondo `surface-2` y filete. Por debajo de 1024 (tableta), chips como en el móvil. Títulos de sección 30
  desde 768.
- **Buscar, Pegar, Salud, Sistema, Dispositivos**: solo cambian el armazón (§13.4) y los tamaños ≥ 768/1024 de los
  componentes (carrusel 300, hoja como diálogo, versus `xl` 30).

### 13.9 SwiftUI (si se elige C)

- `ShellLayout` por ancho (a2 §21.1) con `onGeometryChange(for: CGFloat.self) { $0.size.width }` en la raíz, no
  `horizontalSizeClass` (en iPad ambas clases son `.regular` en casi todos los anchos y no distinguen 768/1024/1280).
- Armazón en `Grid`/`HStack`: columna (300) · contenido · panel (340), cada uno con su `ScrollView`; barra superior en
  un `safeAreaInset(edge: .top)` propio dibujado a mano (no `NavigationSplitView` ni barra de pestañas del sistema: su
  barra lateral y su Liquid Glass no se parecen).
- Preferencia del panel en `@AppStorage("aceneo-panel")`.
- Luz ambiental: §13.6. Atajos de teclado con `.keyboardShortcut` y la hoja «Atajos de teclado» de la web (a2 §9.6)
  solo si hay teclado físico (`GCKeyboard.coalesced != nil`).
- `UISupportedInterfaceOrientations~ipad` con las cuatro y sin `UIRequiresFullScreen` (ventanas redimensionables).

### 13.10 Capturas de referencia que harían falta para el iPad

Hay 768×1024 **solo en oscuro** de las 22 vistas y 1024×1366 **solo en oscuro** de 16 (faltan Agenda, Partido,
Reproductor, Mini, Preferencias y Sistema). Faltarían: las 22 vistas en claro a 768×1024 y 1024×1366, todas a
**820×1180, 1180×820 y 1366×1024** (los iPad de verdad), y los estados de §8.4 en esos tamaños (añadirlos a `SIZES`
con `touch: true, light: true`).
