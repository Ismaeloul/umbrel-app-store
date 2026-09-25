# C0 · Canarios de API de la fase 0.1 (I0)

> 25-sep-2026. Paso 0.1 de `b-arquitectura.md` (§4.1.1, §5.3). Rama `rediseno/nativa`. Resumen con los cambios que
> arrastran: `b-arquitectura.md` §5.3.1. Cada canario es un fichero de `ace-player-neo/apps/ios/Sources/Sonda/` que usa la
> API **tal como la usará su contrato**; se borran al cerrar la fase 0.

## Entorno donde se comprobó

| Qué | Dónde |
|---|---|
| Xcode | 26.6 en `macos-latest` (macOS 26.6.2); el paso «Elegir Xcode» lo encuentra (`/Applications/Xcode_26.6.app`) |
| Simulador | iPhone 16e, iOS 26.2 (arm64) |
| Compilación | `solo_compilar`: Debug de simulador con `build-for-testing` (app + pruebas) y Release de dispositivo sin firmar, con `-warn-long-expression-type-checking=200` y `-warn-long-function-bodies=400` |
| Pruebas en el simulador | `solo_unitarios`: 198 pruebas, 0 fallos (incluye `InfoPlistTests` de fuentes y las de `Puros/`) |
| Linux | `swift:6.2-noble` (Docker en el PC con `scripts/probar-linux.ps1` y trabajo `nucleo-linux` de la CI) |

## Ejecuciones de la CI

| Id | Rama | Tipo | Resultado | Para qué |
|---|---|---|---|---|
| 36162945144 | rediseno/nativa | solo_compilar | rojo | C2 con `Observations { @MainActor in (tupla) }`: el compilador se cae en IRGen |
| 36163440026 | rediseno/nativa | solo_compilar | rojo | C2 con `Observations { @MainActor in Struct(…) }`: se cae igual |
| 36163779111 | nativa/i0-sonda | solo_compilar | verde | C2 con `Observations { estado.inmersivo }` (sin anotar) |
| 36163818991 | rediseno/nativa | solo_compilar | verde | todos los canarios con el plan B de C2 |
| 36164502581 | nativa/i0-sonda | solo_compilar | verde | C2 con la tupla de cinco del contrato **sin** `@MainActor in` |
| 36164566674 | rediseno/nativa | solo_unitarios | rojo | `build-for-testing`: faltaba `IdentificadoresUI.swift` (XcodeGen `optional: true` no basta) |
| 36165365851 | rediseno/nativa | solo_unitarios | verde | 198 pruebas, 0 fallos; C10 comprobado en el simulador |
| 36166522134 | rediseno/nativa | solo_compilar | verde | estado final: C2 sin anotar + plan B, `build-for-testing` en Debug |

## Resultado por canario

| # | Fichero | API / supuesto | Resultado | Notas |
|---|---|---|---|---|
| C1 | `C01Cristal.swift` | `glassEffect(_:in:)`, `Glass.regular.tint(_:).interactive()`, `GlassEffectContainer` | **vale** · banco pendiente | copia de `CristalPalco` y `ModificadorCristal` de §2.2.5 (genérico sobre `Shape`, `some Shape = Capsule()`) |
| C2 | `C02Observations.swift` (+ `C02bSeguimiento.swift`) | `Observations { … }` con tupla | **vale con un ajuste** | con `Observations { @MainActor in … }` el compilador de Xcode 26.6 aborta en IRGen al emitir el *thunk* del cierre `@isolated(any)` (`SyncCallEmission::setArgs` → «SmallVector at maximum capacity»), con tupla y con struct. **Sin** la anotación (el cierre hereda el aislamiento de la `Task { @MainActor … }`) compila en Debug y Release con la tupla de cinco del contrato. §2.3 corregido. El plan B (`withObservationTracking` en bucle) compila y queda en `C02bSeguimiento.swift` como reserva |
| C3 | `C03ReconocedorGestos.swift` | `UIGestureRecognizerRepresentable` con delegado | **vale** · banco pendiente | `makeCoordinator(converter:)` → coordinador `NSObject, UIGestureRecognizerDelegate`; `shouldBeRequiredToFailBy` (borde), simultáneo (carriles); `.gesture(_:)` sobre un `ScrollView` |
| C4 | `C04Entry.swift` | `@Entry` con struct puro y actor opcional | **vale** | también `Bool` y `CGFloat` |
| C5 | `C05SensoryFeedback.swift` | `.sensoryFeedback(trigger:_:)` con cierre | **vale** · banco pendiente | el cierre del contrato devuelve `SensoryFeedback` (no opcional) y el tipo se infiere sin anotar |
| C6 | `C06HojaMedida.swift` | hoja nativa con detent medido | **vale** · banco pendiente | falta ver en pantalla que la hoja medida no salta; si salta, plan B `.fraction` |
| C7 | `C07MenuContextual.swift` | `.contextMenu(menuItems:preview:)`, `Menu` + `.menuOrder(.fixed)`, `accessibilityActions` | **vale** · banco pendiente | con `Section`, `Button(role: .destructive)` y `Toggle` |
| C8 | `C08PosicionScroll.swift` | `ScrollPosition` y `onScrollGeometryChange(for:of:action:)` | **vale** | `ScrollPosition(edge:)`, `scrollTo(edge:)`, `contentOffset` + `contentInsets` |
| C9 | `C09CifrasQueRuedan.swift` | `.contentTransition(.numericText(value:))` en celda fija | **vale** · banco pendiente | — |
| C10 | `C10FuenteVariable.swift` + `Tests/AceNeoTests/InfoPlistTests.swift` | CTFont variable con `wdth` + `wght` desde `UIAppFonts` | **vale** (comprobado en el simulador) | los 3 TTF en el bundle y registrados; `CTFontCopyVariation` = wdth 125 · wght 800; el «4» cambia de avance con wdth 75/100/125; Palco Sans: ascendente 88,5 · descendente 11,5 · interlineado 0 a 100 pt. Nombre: ver «Fuente» abajo |
| C11 | `Tests/AceNeoTests/Puros/Soporte/GeneradosTests.swift` | Swift Testing + `Bundle.module` en Linux | **vale** | `@Test(arguments:)` con tuplas; el mismo fichero corre en Xcode |
| C12 | `Package.swift` | `platforms: [.iOS(.v26), .macOS(.v26)]` en PackageDescription 6.2 | **vale** | — |
| C13 | `C13BarraEstado.swift` | overrides de barra de estado, indicador, bordes y orientaciones en `UIHostingController` | **vale** · banco pendiente | `required init?(coder:)` con `@available(*, unavailable)` compila |
| C14 | `C14IconoEnMenu.swift` | `ImageRenderer` → `UIImage` plantilla en `Label` de `Menu` | **vale** · banco pendiente | — |
| C15 | `C15MarcosGlobales.swift` | `onGeometryChange` en `.global` dentro de un `ScrollView` | **vale** · banco pendiente | — |
| C16 | `C16Mutex.swift` | `final class …: Sendable` con `let` + `Mutex`, sin `@unchecked` (como `EstadoDemo`) | **vale** | añadido por I0; compila en iOS (Debug y Release) y en Linux (`swift:6.2-noble`, paquete de prueba en Docker) |

«Banco pendiente»: la API existe con esa firma y compila en Debug y Release; lo que solo se ve en pantalla (cristal, hoja
medida, vibración con hoja abierta y en horizontal, vista previa del menú, rueda de cifras, barra de estado) lo mira P en
el laboratorio de la fase 0.4.

## Fuente: «Palco Sans» (riesgo 8)

La licencia de Mona Sans (`@fontsource-variable/mona-sans/LICENSE`) dice «with Reserved Font Name "Mona"». La OFL prohíbe
que una versión **modificada** use el nombre reservado, y la Mona con la caja de 1 em centrada es una modificación. Como
prevé el riesgo 8, `scripts/generar-fuentes.py` la llama **«Palco Sans»**:

| Fichero | PostScript | Qué es |
|---|---|---|
| `Resources/Fuentes/PalcoSans-Variable.ttf` | `PalcoSans-ExtraLight` | Mona modificada (hhea/OS2 885/−115/0, USE_TYPO_METRICS) para los `Text` |
| `Resources/Fuentes/MonaSans-Variable.ttf` | `MonaSans-ExtraLight` | el woff2 de la web descomprimido, sin tocar (TextField) |
| `Resources/Fuentes/MartianMono-Variable.ttf` | `MartianMono-SemiExpandedRegular` | el woff2 de la web descomprimido, sin tocar |

`b-arquitectura.md` §1.2, §1.13.3 y §2.2.3 ya dicen `PalcoSans-…`. El enum sigue llamándose `Mona` (es código, no el
nombre de la fuente).

## Otros hallazgos

- `project.yml`: un fichero de fuentes con `optional: true` que no existe rompe `build-for-testing` del objetivo que lo
  incluye. `Sources/Armazon/IdentificadoresUI.swift` existe ya como esqueleto (`enum IDUI {}`).
- `solo_compilar` usa `build-for-testing` en Debug para compilar también las pruebas.
- La alarma de tipado lento se salta la interfaz vieja hasta la poda: hoy `EscenarioView.swift` tarda 24,6 s en un
  `body` y `ReproductorVistas.swift` 1,3 s; ningún fichero nuevo pasa de los límites.
- Avisos que quedan fuera de la interfaz vieja: `nonisolated(unsafe)` innecesario en `Core/Dominio/Canales.swift` (lo
  quita M2, §1.4) y «All interface orientations must be supported unless the app requires full screen» (solo iPhone sin
  boca abajo). Ninguno bloquea; los canarios y los ficheros nuevos no dan avisos.
- En `Package.swift`, `Fixtures.raiz` sube 7 niveles desde `Puros/Soporte/Fixtures.swift` (el diseño decía 6).
