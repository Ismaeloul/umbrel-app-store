# B · Arquitectura final de la app nativa «Palco» 0.8.1 (fase 3)

> Documento de trabajo para los agentes que programan. Escrito el 25-sep-2026 por el arquitecto jefe a
> partir de B1 (fidelidad), B2 (nativa) y B3 (riesgo mínimo), los tres veredictos del jurado y las
> especificaciones a1–a9 de esta carpeta. Contrastado con el código real de `ace-player-neo/apps/ios`
> (rama `rediseno/palco`, `e1e5767`: `project.yml`, `Config/*`, `Sources/Core/**`, `Sources/Player/**`,
> `Sources/App/*`, `Sources/Debug/*`, `Tests/**`) y con `.github/workflows/ios.yml`.
>
> **Orden de mando**: las 10 decisiones de Isma (§0.2) → este documento → a1–a9 (medidas, colores, textos,
> reglas, plazos y estados: aquí no se repiten, se **ubican**: qué fichero los implementa y con qué se
> prueban) → B1/B2/B3 (solo consulta). Si un agente encuentra una contradicción que este documento no
> resuelve, para y pregunta al integrador; no decide por su cuenta.
>
> Rutas relativas a `ace-player-neo/apps/ios/` salvo que se diga otra cosa. «web» = `ace-player-neo/apps/web/src`.
> «[L]» = fichero puro (solo `Foundation`) que además compila y se prueba en Linux (§1.13.2).

---

## 0. Decisión

### 0.0 Correcciones posteriores (MANDAN sobre todo lo demás del documento)

1. **«Otras fuentes» del canal, calcado de la web.** Isma confirmó (25-sep, probado en su Chrome) que la web
   YA lo tiene: en el teatro de un canal suelto, la pestaña «Fuentes» se titula «Otras fuentes · N» y enseña
   las hermanas de la biblioteca (`librarySiblings` de `apps/web/src/features/sources/model.ts`: web +
   favoritos + recientes, mismo canal con `channelMatchScore` ≥ 92) como carteles de fuente, y la cabecera del
   canal dice «… · N fuentes del mismo canal». La app hace EXACTAMENTE eso (mismos datos, título, cartel y
   textos). Donde este documento diga «Otras fuentes» (calcado de la web, §0.0 punto 1), `footballResolve` con el nombre del canal,
   «Buscando otras señales…» u `OtrasSenales.swift`, léase lo anterior: NO se llama a `footballResolve` para
   un canal suelto y no hay texto nuevo. El fichero se llama `OtrasFuentes.swift` (o va dentro del panel de
   fuentes, a criterio de M6). La pregunta A-6 queda resuelta así.
2. **`healthLive` se queda `web`.** El servidor 0.8.1 ya está implementado y verificado en el commit `e1e5767`
   abriendo solo `health`, `settingsUpdate`, `pairingCreate`, `devicesList` y `deviceRevoke` (a9 §0 y §6.1).
   La app usa `ping` para saber si el servidor vive y su versión. Donde el documento diga que `healthLive` pasa a
   `any` o que M8 debe abrirla, NO se hace; `Rutas.swift` no la incluye. M8 queda en: subir versiones a 0.8.1,
   CHANGELOG, documentación y release (lo hace el integrador al final).
3. **Anexo A resuelto con la regla de Isma «lo que tiene la web, ni más ni menos, más las mejoras nativas
   acordadas»:** A-1 fuera; A-2 fuera; A-3 sí (barra de estado legible: es una mejora nativa); A-4 se queda;
   A-5 botón con el aspecto de la web; A-6 ver punto 1; A-7 sí (la ayuda describe los gestos que la app tiene);
   A-8 sí.
4. **Cierre de la fase 0 (I0, 25-sep).** `nativa/palco` fusionada en `rediseno/nativa`; `Sources/Sonda` y
   `App/PalcoProvisional.swift` borrados (lo que Palco tomaba de los canarios va por `Armazon/Hojas.swift` y
   `Armazon/Menus.swift`). Cambios de contrato que ya están en su sección: §2.2 (lo que calibró P: `.tarjeta()`
   con `R.xl`, `Patron.mitades`, `altoLinea 1.45` heredado, `llenarAncho`, `trackingCapsulaEm`, contador del
   segmentado, Martian con su caja), §2.3 (`PreferenciasLocales.estiloVentana` y la raíz con el banco y la galería),
   §2.4.2 (`Hoja.muestra`), §2.4.5 (`.piezaVuelo` ya publica), §3.3.1 (`-AceNeoDesplazar`,
   `-AceNeoLaboratorioSeccion`), §4.4 (`solo_uitests` con comas) y §5.3.1 (canarios cerrados).

### 0.1 Base elegida, injertos y correcciones

| Propuesta | Jurado 1 | Jurado 2 | Jurado 3 | Suma |
|---|---:|---:|---:|---:|
| **B2 · nativa** | 39,5 | 39,5 | 41,5 | **120,5** |
| B1 · fidelidad | 40 | 39,5 | 38 | 117,5 |
| B3 · riesgo mínimo | 38,5 | 38,5 | 37 | 114 |

**Base: B2** (la mejor puntuada). Se conserva de B2: reparto por oleadas con carpetas exclusivas, `ShellLayout`
puro (aquí `Maquetacion`), `CapaInmersiva` fuera de cualquier navegación, fuente `MonaSansPalco` con métricas
normalizadas, `IdentificadoresUI.swift` compilado en la app y en los UITests, capturas nombradas con el tamaño
**real** de la ventana, `VigiaRed`, AirPlay solo con rutas, `RutaID` generado, `vistaActiva` por entorno y
todo lo copiable **generado** desde la web con `--check`.

**Correcciones a B2** (señaladas por los jurados, todas obligatorias):

| Fallo de B2 | Se hace |
|---|---|
| Teatro en un `NavigationStack` por pestaña con `navigationTransition(.zoom)` | Capa propia del teatro en el `ZStack` del armazón y transición propia (injerto de B1, con la vuelta corregida, §3.5) |
| Hojas con el cristal del sistema | `.sheet` nativa con **fondo opaco** `Palco.glassSolid` (a1 §6, a2 §9.2) |
| Doble toque con `TapGesture` en `simultaneousGesture` | Reconocedores UIKit con `require(toFail:)` (B1) |
| Háptica mezclando `sensoryFeedback` y generadores UIKit, con efectos en `condition` | Un pulso central y **un único** `.sensoryFeedback` en la raíz (B1 + regla pura de B3) |
| Píldora que se estira; minuto de la cápsula del marcador que desaparece; hoja horizontal sin ancho máximo | Fuera las dos primeras (la web no las tiene); contenido de hoja a 420/560/760 en horizontal |
| `scenePhase` dentro del `UIHostingController`; `.preferredColorScheme` | `SceneDelegate` → `CicloVida` como única fuente; tema con `window.overrideUserInterfaceStyle` (B1) |
| `SWIFT_VERSION "6"`, `GENERATE_ASSET_SYMBOLS: YES`, simulado solo probado en iOS, `EstadoDemo: @unchecked Sendable` | `"6.0"` (lo de hoy), símbolos de assets **NO**, núcleo de la demo puro y probado en Linux (B3), `final class` con `let` + `Mutex` sin `@unchecked` |
| `PasteButton` («Pegar del portapapeles» con aspecto del sistema) | Botón propio con el aspecto de la web (pregunta A-5) |

**Injertos de B1**: ciclo de vida UIKit con `HostingRaiz` (barra de estado por zona, indicador de inicio,
orientaciones de pantalla completa), `AccionMenu` como modelo único de `Menu`/`.contextMenu`/`accessibilityActions`,
vista previa propia del menú del vídeo, pestañas del teatro fijadas con `LazyVStack(pinnedViews:)` y paneles montados,
cifras que ruedan **dentro** de celdas fijas, dispositivo propio distinto del visor «iPhone de Isma» en las capturas,
comparación estricta con transparencia reducida y tolerante en el cristal, transición tarjeta → teatro con el vuelo
de escudos `plusLighter` de la web, tabla háptica entera cableada.

**Injertos de B3**: un solo módulo de app con las carpetas del núcleo intactas (`Core/`, `Player/`: sin mover
60 ficheros, se conserva el `git blame`), `Package.swift` espejo que compila **en su sitio** los ficheros [L] y un
trabajo Linux antes del de macOS, canarios de API (un fichero por API dudosa, con plan B), poda hecha por **un**
agente con `unitarios` en verde antes del paralelo, una sola puerta para `.sheet(`, `.contextMenu(`,
`.sensoryFeedback(` y `VistaVideo(` vigilada por el linter, `Mona` no aislada con candado, estilos de texto como
datos, `EfectosEvento.de(_:)` puro, `DatosApp` concreto (una `Consulta<T>` por ruta), golden de la demo generados
ejecutando la demo **real** de la web, `CristalPalco.vidrio(_:)` como único sitio de tintes con el interruptor
`vidrioEnListas`, orden de commits en el que cada commit compila solo.

### 0.2 Las diez decisiones de Isma, en una línea cada una

| # | Decisión (no se discute) | Dónde queda |
|---|---|---|
| 1 | App nativa SwiftUI (no WebView) que calca 1:1 la web móvil a 390×844 y 844×390, claro y oscuro; todo lo de la web y nada más (salvo 3-6) | todo el documento; fallos de la web que no se copian en §0.4 |
| 2 | iOS 26 mínimo, APIs modernas, sin `#available` ni fallbacks 17-25, Swift 6 estricto; se compila solo en la CI (Xcode 26.6, SDK 26.5) | §1.13, §4.4, §5 |
| 3 | Liquid Glass de verdad, háptica del mapa, muelles, tarjeta → teatro, borde izquierdo, tirar para actualizar, arrastrar el vídeo abajo, deslizar el vídeo a los lados, doble toque, cifras que ruedan, tocar la pestaña activa sube | §0.5, M4, M5, M6, P |
| 4 | Barra de pestañas **de la web** con `glassEffect`, no `TabView` | M4 (`BarraPestanas`) |
| 5 | Hojas y menús **nativos** con el contenido de la web | M4 (`Hojas.swift`, `Menus.swift`) |
| 6 | AVPlayer (HLS del servidor), PiP, AirPlay, bloqueo, segundo plano, una sola `AVPlayerLayer`, casa/Tailscale automático, emparejar por QR/enlace (pantalla nueva: lo único que la web no tiene) | M3, M1, M7 |
| 7 | Se borra la interfaz actual y sus UITests; se reutiliza modernizado el núcleo invisible | §1.11, §1.12, fase 0.2 |
| 8 | Servidor 0.8.1: abre a `/native` con bearer `health`, `settingsUpdate`, `pairingCreate`, `devicesList`, `deviceRevoke`; app y servidor salen como 0.8.1 con el mismo bundle id, nombre e icono | M8, M1, §1.13 |
| 9 | En horizontal, lo que hace la web a 844×390 (maquetación ≥ 768; el partido pasa a inmersivo); los fallos de la web no se copian | M4, §0.4 |
| 10 | El servidor simulado sirve **los mismos datos** que `?demo=1` para comparar capturas con `capturas/_revision/web-palco/final/` | M2, fase 2 (I2) |

### 0.3 Donde a1–a9 dicen otra cosa (y conflictos entre ellas): resolución

| Tema | a1–a9 | Se hace |
|---|---|---|
| Cristal | material + tinte; «no usar `glassEffect`» (a1 §13.6, a2 §21.4, a3 §16.1, a4 §23.3) | `glassEffect` con el tinte del token (decisión 3); opaco exacto de la web con transparencia reducida |
| Hojas | hoja propia `PalcoSheet` (a1 §10.18, a2 §21.7, a3 §16.1, a5 §8.3, a6 §17.3) | `.sheet` nativa (decisión 5) con asa del sistema, detents medidos y fondo `glassSolid` |
| Menús | menú propio en el punto, sin vista previa (a1 §10.19, a2 §21.8, a3 §6.5, a4 §5.7, a5 §8.3, a6 §17.3) | `.contextMenu(menuItems:preview:)` y `Menu` con el contenido, orden, peligro y ✓ de la web; `.menuOrder(.fixed)` |
| Háptica al abrir un menú contextual | a1 §8.1 añade `medium`; a4 §5.7 ninguna | la del sistema (el `.contextMenu` ya vibra): **ninguna propia** |
| Transición al partido | capa viajera solo de escudos, «`.zoom` no se parece» (a3 §4.8) | la tarjeta crece hasta el teatro (decisión 3) **y** dentro viaja el bloque de escudos de la web; la vuelta es la de la web (§3.5) |
| Tocar la pestaña activa | «no hace nada» (a2 §4.4) | sube arriba, sin háptica (decisión 3) |
| Tirar para actualizar | no (a2 §21.10, a3 §17.3) | sí, solo en la agenda (decisión 3) |
| Doble toque en el vídeo | nada (a4 §5.3) | pantalla completa horizontal (decisión 3) |
| Cifras | sin animación salvo la paleta (a1 §3.5, a8 §12.2) | paleta al destapar + `contentTransition(.numericText(value:))` dentro de cada celda al cambiar (gol) |
| Alto de línea en varias líneas | `UILabel` (a1 §13.3, a3 §1.4.1) | fuente `MonaSansPalco` (caja de 1 em centrada) + `altoDeLinea`; el `UILabel` queda como plan B del laboratorio |
| Tema | `.preferredColorScheme` (a1 §13.2, a2 §21.11, a6 §7.1) | `window.overrideUserInterfaceStyle` (llega también a hojas y menús del sistema y vuelve bien a «Sistema») |
| `healthLive` | se queda `web` (a9 §0, §6.1; a7 §2.4.1) | **se queda `web`** (§0.0 punto 2; ya implementado en e1e5767) |
| Sección «Servidor» de Ajustes | añadida (a6 §8 bis) | **fuera por defecto** (decisiones 1 y 6: lo único nuevo es emparejar); los textos que la citaban se adaptan (M7); pregunta A-1 |
| Accesos rápidos del icono | añadidos (a2 §25, §27.6) | **fuera** (Safari en el iPhone no los tiene); pregunta A-2 |
| Fila propia en Dispositivos | a9 §3.5.1: cápsula «Este dispositivo», botón «Olvidar» | **a6 §8.10.2-§8.10.3** (posterior y más completo): «Este iPhone», «Olvidar este iPhone», «¿Olvidar? Pulsa otra vez», menú «Olvidar este iPhone»/«Olvidar ya» |
| Aviso en emparejar tras «Olvidar este iPhone» | a6 §8.10.3 y a9 §3.5.4: aviso neutro | **a2 §23.3** (dueña de esa pantalla y la más reciente): **sin aviso** |
| «Datos técnicos» en inmersivo | B1 los ponía en hoja | panel de cristal de vídeo sobre la imagen (a4 §15); en vertical es la pestaña del teatro; **no existe hoja «Datos técnicos»** |
| AirPlay | a4 §24.2 lo proponía arriba a la derecha | en la cápsula de abajo a la derecha `[Directo · AirPlay · pantalla completa]`, **solo** con `AVRouteDetector.multipleRoutesDetected`; a 375 con «Reanudar» el botón Directo pasa a solo icono antes que solaparse (M6) |
| Texto de ayuda del modo | «El botón LIVE…» | «El botón «Directo»…» (a6 §5.1) |
| Visor | persistente (app 0.8.0) | `v_` + 14 base64url por proceso (a8 §3.11.5) |
| Icono | variante oscura por defecto (a8 §7.4) | `AppIcon` actual **intacto** (decisión 8); `Marca.imageset` con una sola variante (la oscura de `apps/web/public/icon.svg`) |
| Dynamic Type | a8 §12.2 proponía `.dynamicTypeSize(.large)` | tamaños fijos por `Mona`, sin `dynamicTypeSize` (a2 §26) |
| `NavigationStack` | a5 §8.1 lo proponía con la barra oculta | prohibido (linter) |
| iPad | pendiente (a8 §13) | solo iPhone (`TARGETED_DEVICE_FAMILY "1"`) |

### 0.4 Fallos de la web que NO se copian (decisión 9)

| Fallo de la web | Se hace |
|---|---|
| En horizontal ≥ 768 el contenido no suma `safeL` (a2 §20.2) | se suma (`Maquetacion.rellenoIzquierdo` y `rellenoDerecho`) |
| Menús recortados a la ventana y no a la zona segura; el menú del vídeo (652 pt) queda cortado por arriba en horizontal (a2 §20.3, a4 §5.7) | menús del sistema: respetan zonas seguras y se desplazan |
| Hápticas del mapa sin cablear (barra, cerrar hoja arrastrando, 4 pulsaciones largas) (a1 §0.6) | tabla de a1 §8.1 cableada entera (con la regla de §0.3 para la pulsación larga) |
| Con transparencia reducida la cápsula de directo en cristal pierde el rojo y la de oro el oro (a1 §0.7) | conservan `#D12E25` y `#FFD60A` |
| Hoja sin botonera sin `safeB`; hoja del SE horizontal con esquinas rectas; arrastre de la hoja con retardo (a2 §20.4, §20.5, §20.11) | hoja nativa |
| Toasts que saltan al entrar o salir otro (a2 §20.8) | se recolocan con `Movimiento.estandar` |
| Barra de estado siempre blanca, ilegible en claro al pasar el héroe (a3 §4.7) | blanca sobre el héroe, la franja negra del teatro y el cartel de emparejar; por tema en el resto (pregunta A-3) |
| Controles del vídeo a opacidad 0 fuera del árbol de VoiceOver (a4 §5.7-4) | con VoiceOver activo no se autoocultan |
| El cartel de fuente no tiene camino accesible a su menú (a4 §5.7) | `accessibilityActions` con las mismas opciones (y en tarjetas, filas, dispositivos y vídeo) |
| (No es fallo) barra superior de 64 y no 52 en horizontal (a2 §20.1) | se calca **64** (lo que se ve y está aprobado) |

### 0.5 Lo que la app añade (la lista entera; nada más)

- Decisión 3: `glassEffect` en todo lo que en la web es `.glass*`; háptica de a1 §8.1; muelles; transición
  tarjeta/héroe/mini → teatro; volver desde el borde izquierdo (solo el teatro en vertical); tirar para actualizar
  (solo la agenda); arrastrar el vídeo hacia abajo para minimizar (interactivo); deslizar el vídeo a los lados =
  otra fuente; doble toque = pantalla completa; cifras que ruedan; tocar la pestaña activa sube arriba; toasts que
  se recolocan con muelle.
- Decisiones 4 y 5: barra de la web con Liquid Glass; hojas y menús nativos con vista previa.
- Decisión 6: PiP, AirPlay (solo con rutas), controles de bloqueo y Now Playing, audio en segundo plano, cambio
  casa/Tailscale sin aviso, pantalla de emparejar (a2 §22) con su hoja «¿Emparejar con otro servidor?».
- Accesibilidad sin cambio visual: visor de contenido grande (a2 §26), `accessibilityActions` de los menús.
- **«Otras fuentes» (calcado de la web, §0.0 punto 1)** en el teatro de un canal suelto (pedido por Isma el 25-sep, memoria de la
  fase 3): `footballResolve` con el nombre del canal, candidatas sin la propia, «Buscando otras señales…», dibujado
  con los carteles de fuente de la web (M3 + M6; pregunta A-6).
- En la hoja de ayuda, bloque «Gestos»: las filas de la web **más** las de los gestos nativos (borde izquierdo, doble
  toque, deslizar el vídeo a los lados, tirar para actualizar, tocar la pestaña activa), con el mismo formato (M7).
- Galería «Sistema» (a1 §11: la web la tiene escondida; 7 toques en «Versión»).
- Nada de accesos rápidos, sección «Servidor», hojas o botones que la web no tenga.

### 0.6 La arquitectura en doce líneas

1. **Un solo objetivo de app** `AceNeo` (Swift 6.0, concurrencia `complete`, sin aislamiento por defecto ni
   «Approachable Concurrency»), con las carpetas del núcleo intactas y cinco carpetas nuevas: `Palco`, `Armazon`,
   `Pantallas`, `Core/Datos`, `Core/Reglas`.
2. **Todo lo puro vive en `Core/Reglas`** (y `Core/Models`, `Core/Dominio`, `Debug/DemoNucleo`): compila a la vez en
   la app y en un `Package.swift` espejo que se prueba en Linux (Docker en el PC y un trabajo de Ubuntu en la CI).
3. **Ciclo de vida UIKit** (`AppDelegate` `@main` + `SceneDelegate` + `HostingRaiz: UIHostingController`) solo para
   lo que SwiftUI no deja: barra de estado por zona, indicador de inicio, orientaciones de pantalla completa, bordes
   diferidos, tema de la ventana, enlaces `aceneo://`. El resto es 100 % SwiftUI.
4. **Armazón propio**: pestañas vivas en un `ZStack`, capa del teatro encima, barra inferior de la web con
   `glassEffect` (barra superior en horizontal), velo, mini, capa de vuelo, avisos y capa inmersiva; todas las
   fórmulas en `Maquetacion` (pura, probada con seis tamaños).
5. **Hojas y menús nativos** con una sola puerta cada uno (`Armazon/Hojas.swift`, `Armazon/Menus.swift`) y un
   modelo único de acciones (`AccionMenu`) que también alimenta VoiceOver.
6. **Sistema de diseño `Palco`** construido en la fase 0: colores, iconos y plazos **generados** desde la web;
   `Mona` por ejes con `MonaSansPalco`; primitivas con las firmas de §2.2.
7. **Una sola `AVPlayerLayer`** (`SuperficieVideo`) con huecos por prioridad `mini < teatro < inmersivo < vuelo`;
   reproductor, sesión de fuentes y presentación viven fuera de las vistas (vida de proceso).
8. **Datos calcados de TanStack**: `DatosApp` con una `Consulta<T>` por ruta, `TiempoReal` con respaldo por sondeo,
   `RepartidorEventos` que aplica `EfectosEvento.de(_:)` (puro, tabla de a7 §6.3-6.4).
9. **Gestos con reconocedores UIKit** donde conviven con un `ScrollView` o con el borde; todos los umbrales en
   funciones puras con los números de la web.
10. **Háptica**: un pulso central (`Haptica.disparar`) con anti-ráfaga pura y un único `.sensoryFeedback` en la raíz.
11. **Servidor simulado = demo de la web**: datos y golden generados ejecutando la demo real con el reloj fijado;
    capturas del simulador con los nombres de `final/` y comparación automática.
12. **Paralelizable**: fase 0 (cimientos + Palco, 2 agentes) → fase 1 (8 módulos con carpeta exclusiva) → fase 2
    (integración y calco, 2 agentes), iterando con `solo_compilar` en la CI.

---

## 1. Árbol completo de `apps/ios`

### 1.1 Leyenda

- **Propietario**: `I0` cimientos (fase 0) · `P` Palco (fase 0, luego soporte) · `M1`…`M8` módulos de la fase 1 (§3) ·
  `I1` integración y `I2` calco (fase 2). «`I0→M4`» = contrato escrito por I0 en la fase 0.3 y mantenido después por M4;
  cambiar su **firma** es un cambio de contrato y solo lo hace el integrador (§5.1).
- **Estado**: `[Q]` se queda tal cual · `[M]` se queda con cambios · `[N]` nuevo · `[B]` se borra · `[G]` generado (no se
  edita a mano; cabecera `// GENERADO por scripts/<x>. No editar.`) · `[L]` puro: solo `Foundation`, compila también en Linux.
- XcodeGen incluye carpetas enteras: **crear un fichero no toca `project.yml`**. Solo I0 y el integrador tocan
  `project.yml`, `Package.swift`, `Config/*` y `.github/workflows/ios.yml`.

### 1.2 Raíz, configuración, recursos y scripts

```
apps/ios/
├─ project.yml                          [M] I0 · XcodeGen (§1.13.1)
├─ Package.swift                        [N] I0 · espejo SwiftPM «NucleoPuro» de los ficheros [L] (§1.13.2)
├─ README.md                            [M] I1 · CI, prueba en Linux, argumentos de Debug, capturas
├─ .gitignore                           [M] I0 · + .build/ (SwiftPM en Docker)
├─ Config/
│  ├─ AceNeo.xcconfig                   [M] I0 · MARKETING_VERSION = 0.8.1 (ACE_BUNDLE_ID y ACE_DISPLAY_NAME sin cambios)
│  └─ Info.plist                        [M] I0 · UIAppFonts, sin ~ipad, escena creada por código (§1.13.3)
├─ Resources/
│  ├─ Assets.xcassets/
│  │  ├─ AppIcon.appiconset/            [Q] intacto: claro, oscuro y tintado de hoy (decisión 8)
│  │  ├─ AccentColor.colorset/          [Q] #FFD60A (alertas del sistema, selector de AirPlay)
│  │  ├─ Colores/Bg.colorset/           [Q] lo exige UILaunchScreen; los otros 22 colorsets se borran
│  │  └─ Marca.imageset/                [M] P · una sola variante (la oscura de apps/web/public/icon.svg)
│  └─ Fuentes/
│     ├─ PalcoSans-Variable.ttf         [N][G] P · Mona con hhea/OS2 885/−115/0 y USE_TYPO_METRICS; PostScript «PalcoSans-ExtraLight» (la OFL reserva «Mona», §5.3.1)
│     ├─ MonaSans-Variable.ttf          [N][G] P · original, PostScript «MonaSans-ExtraLight» (solo TextField)
│     ├─ MartianMono-Variable.ttf       [N][G] P · «MartianMono-SemiExpandedRegular» (hashes, datos técnicos, teclas)
│     ├─ OFL.txt                        [N] P · licencia (se enseña en Acerca de)
│     └─ ORIGEN.json                    [N][G] P · sha-256 de los woff2 de @fontsource y parámetros aplicados
└─ scripts/
   ├─ build-ipa.sh                      [Q]
   ├─ pila-e2e.mjs                      [Q]
   ├─ generar-catalogo-errores.mjs      [Q] M1
   ├─ generar-recursos.mjs              [M] P · Marca desde apps/web/public/icon.svg; ya no escribe colorsets; AppIcon no se toca
   ├─ generar-tokens.mjs                [N] I0→P · tokens.css (hex de :root y de [data-scheme='dark']) → ColoresPalco.generado.swift
   ├─ generar-iconos.mjs                [N] I0→P · ui/icons.ts → NombreIcono.generado.swift + TrazosIcono.generado.swift (arcos → cúbicas)
   ├─ generar-fuentes.py                [N] I0→P · woff2 → 3 TTF (fontTools + brotli); --check compara ORIGEN.json
   ├─ generar-plazos.mjs                [N] I0→M1 · api/client.ts (TIMEOUTS) + sources/session.ts → PlazosWeb.generado.swift
   ├─ generar-rutas.mjs                 [N] I0→M1 · packages/shared/src/routes.ts → RutaID.generado.swift
   ├─ generar-vectores.ts               [N] M2 · corredor (tsx): importa scripts/vectores/*.ts con calzos de localStorage y Date
   ├─ vectores/<area>.ts                [N] dueño del área (§3) · entradas y salidas del TypeScript real de un área
   ├─ generar-vectores.mjs              [B] M2 · su batería pasa a vectores/dominio.ts (misma salida byte a byte, comprobada con --check antes de borrar)
   ├─ generar-textos.mjs                [N] M3 · literales de notify/toast/fail (player/*, sources/session.ts, notices/*) → Vectores/textos-web.json
   ├─ generar-demo.ts                   [N] M2 · demo real de la web (tsx, reloj fijo, Math.random sembrado) → SemillasDemo.generado.swift + golden
   ├─ revisar-swift.mjs                 [N] I0 · linter de patrones prohibidos (§5.2); tarda segundos
   ├─ probar-linux.ps1                  [N] I0 · Docker swift:6.2-noble + tzdata + swift test (PC de Isma)
   └─ comparar-capturas.py              [N] I2 · simulador ↔ web (Pillow), informe HTML
```

Todos los generadores aceptan `--check` (sale con código 1 y dice qué fichero está viejo). Los de TypeScript se lanzan
desde `ace-player-neo/` con `corepack pnpm@10.18.2 exec tsx apps/ios/scripts/<x>.ts [--check]` (tsx 4.23 ya es
devDependency del monorepo y resuelve los imports sin extensión de la web).

### 1.3 `Sources/App`

```
Sources/App/
├─ AppDelegate.swift                    [N] I0→M4 · @main UIKit; MigracionClaves antes de nada; AVAudioSession; orientaciones
├─ SceneDelegate.swift                  [N] I0→M4 · ventana + HostingRaiz; tema de la ventana; aceneo:// en frío y en caliente; fases → CicloVida
├─ HostingRaiz.swift                    [N] I0→M4 · UIHostingController: barra de estado, indicador de inicio, bordes diferidos, orientaciones
├─ RaizView.swift                       [N] I0→M4 · dos fases emparejar ↔ app (a2 §27.2), entorno, HapticaRaiz, fuente raíz
├─ Raiz.swift                           [N] I0→M4 · modelo de la raíz: éxito (a2 §22.6) y acceso perdido (a2 §23.3)
├─ ContenedorApp.swift                  [N] I0 (contrato) · crea y cablea los objetos de vida de proceso; conforma EntornoSesionFuentes
├─ EstadoVentana.swift                  [N] I0→M4 · @Observable que aplica el HostingRaiz
├─ CicloVida.swift                      [N] I0→M4 · fases de escena desde el SceneDelegate (sustituye a scenePhase)
├─ PreferenciasLocales.swift            [N] I0→M4 · aceneo-tema, aceneo-transparencia, aceneo-pb
├─ MigracionClaves.swift                [N][L] I0→M4 · nombres de las claves + migración 0.8.0 → claves de la web (a1 §13.10)
├─ Entorno.swift                        [M] M1 · servicios del núcleo; ModoEjecucion con los argumentos de §3.3.1
├─ AceNeoApp.swift                      [B] (lo sustituyen AppDelegate y SceneDelegate)
├─ AppModel.swift                       [B] se parte en SesionApp, DatosApp, Navegador y PresentacionReproductor (fase 0.2)
└─ RootView.swift                       [B] su onOpenURL pasa a SceneDelegate/SesionApp y su diálogo a la hoja «otro servidor»
```

### 1.4 `Sources/Core`

```
Sources/Core/
├─ Auth/
│  ├─ Emparejamiento.swift              [M] M1 · canje con la primera `u`, guarda la primera de cada tipo (a9 §3.4)
│  ├─ Llavero.swift                     [Q] M1
│  └─ Servidores.swift                  [M][L] M1 · PairingLink.servidores: [URL] (todas las u=); ServerVia.etiqueta «Red de casa»
├─ Cache/
│  ├─ DiskCache.swift                   [Q] M1 · agenda, biblioteca, arranque y preferencias para pintar en frío
│  └─ CacheImagenes.swift               [M] M1 · + byPreparingForDisplay()
├─ Dominio/
│  ├─ Canales.swift                     [M][L] M2 · sin nonisolated(unsafe)
│  └─ ParaTi.swift                      [Q][L] M2
├─ Models/
│  ├─ Biblioteca.swift · Eventos.swift · Futbol.swift · Primitivas.swift · Reproduccion.swift   [Q][L] M1
│  └─ Sistema.swift                     [M][L] M1 · + PairingCreateBody {baseUrl, alternateBaseUrls?}, SettingsUpdateBody
├─ Networking/
│  ├─ APIClient.swift                   [M] M1 · plazo total, caché GET/resto, reintento de dirección solo en GET, 401 callado mientras se olvida
│  ├─ APIError.swift                    [M][L] M1 · textos del cliente web (a7 §3.3), `reintentable`, `describirFallo`
│  ├─ Endpoint.swift                    [M][L] M1 · + #if canImport(FoundationNetworking)
│  ├─ ErrorCatalog.swift                [Q][L][G] M1
│  ├─ PlazosWeb.generado.swift          [N][L][G] M1
│  ├─ RutaID.generado.swift             [N][L][G] M1 · id, método, ruta, acceso y credencial de cada ruta v1 de routes.ts
│  ├─ Rutas.swift                       [M] M1 · + health, settingsUpdate, pairingCreate, devicesList, deviceRevoke en /native
│  ├─ SSEParser.swift                   [Q][L] M1
│  ├─ SSEClient.swift                   [M] M1 · esperas de EsperaSSE; reanuda desde el id que le pase TiempoReal
│  └─ ServerResolver.swift              [Q] M1
├─ Datos/                               (todo @MainActor, vida de proceso)
│  ├─ Consulta.swift                    [N] I0→M1 · una consulta (TanStack mínimo): datos, error, frescura, reintentos, en vuelo
│  ├─ PoliticaConsulta.swift            [N] I0→M1 · políticas de a7 §4.1-§4.2 con nombre
│  ├─ DatosApp.swift                    [N] I0→M1 · todas las consultas + mutaciones con escritura directa (a7 §4.3)
│  ├─ TiempoReal.swift                  [N] I0→M1 · SSE con estados, Last-Event-ID de proceso, respaldo a los 10 s
│  ├─ RepartidorEventos.swift           [N] I0→M1 · aplica EfectosEvento, sondeo de respaldo 5 s / 20 s, oyentes
│  ├─ SesionApp.swift                   [N] I0→M1 · fase, conexión, dispositivo, versión, capacidades, olvidar, acceso perdido
│  ├─ SenalPartidos.swift               [N] M1 · scan.progress por partido (20 min; `cancelled` lo borra)
│  ├─ MarcadoresDestapados.swift        [N] M1 · destapados de proceso (se vacían al cambiar lo que suena)
│  ├─ RelojCompartido.swift             [N] M1 · tic de 20 s mientras haya observadores
│  ├─ BajasPendientes.swift             [N] M1 · «Deshacer» de 6 s de la biblioteca, envío en segundo plano
│  ├─ VigiaRed.swift                    [N] M1 · NWPathMonitor → ServerResolver.invalidar() + TiempoReal.reconectarYa()
│  └─ VigiaVersion.swift                [N] M1 · ping tras resync, al reabrir o tras ≥ 30 min fuera (a7 §5.2)
├─ Emparejar/
│  ├─ ModeloEmparejar.swift             [M] M7 · de PairingViewModel + estados de cámara + canje automático + pausa de 60 s
│  └─ EscanerQR.swift                   [M] M7 · de QRScannerView: embebido, rectOfInterest, RotationCoordinator, interrupciones
└─ Reglas/                              (todo [L])
   ├─ Navegacion/Destino.swift          [N] I0→M4 · Pestana, PestanaCanales, SeccionAjustes, Destino, Sentido
   ├─ Maquetacion/Maquetacion.swift     [N] I0→M4 · fórmulas del armazón
   ├─ Transicion/GeometriaVuelo.swift   [N] M4 · interpolación de marcos del zoom y de los vuelos
   ├─ Iconos/NombreIcono.generado.swift [N][G] I0→P · los 52 nombres de ui/icons.ts
   ├─ Senal/EstadoSenal.swift           [N] I0→M2
   ├─ Avisos/TiposAviso.swift           [N] I0→M2 · TonoAviso, ClaseAviso, Toast, ContenidoLinea
   ├─ Avisos/ColaToasts.swift           [N] M2 · notices/toasts.ts
   ├─ Avisos/LineaEstado.swift          [N] M2 · notices/statusLine.ts
   ├─ Avisos/Redaccion.swift            [N] M2 · reglas de wording.test.ts
   ├─ Haptica/TipoHaptico.swift         [N] I0→M2 · TipoHaptico + ReglaHaptica (40 ms, selección callada con movimiento reducido)
   ├─ Haptica/SitiosHapticos.swift      [N] M2 · tabla de a1 §8.1 como datos
   ├─ Gestos/Deslizamiento.swift        [N] M2 · classifySwipe, Volver (0,35·ancho o 450 pt/s con ≥ 24), GestosMini (72, 25 %, 320)
   ├─ Menus/OpcionMenu.swift            [N] I0 · descriptor puro de una opción de menú
   ├─ Color/ColorOKLab.swift            [N] M2 · lib/color.ts
   ├─ Color/Equipos.swift               [N] M2 · lib/teams.ts (versusPair ΔE < 0,14, teamLight, teamInitials, competitionShort)
   ├─ Color/TonoCanal.swift             [N] M2 · channelTone, nameTone, channelDorsal, channelAbbrev
   ├─ Formatos/FechasES.swift           [N] M2 · tablas propias (ene…sept…dic, dom…sáb), fechas largas, formatWhen
   ├─ Formatos/NumerosES.swift          [N] M2 · coma decimal, KB/s ↔ MB/s, splitDigits
   ├─ Formatos/Texto.swift              [N] M2 · foldText (NFD sin U+0300–U+036F), keepUnitsTogether, plurales, «, … y …»
   ├─ Datos/RutaConsulta.swift          [N] I0→M1
   ├─ Datos/EfectosEvento.swift         [N] I0→M1 · SSEEvent → [EfectoEvento] (a7 §6.3-6.4)
   ├─ Datos/EsperaSSE.swift             [N] I0→M1 · min(60, 3·2^min(n−1, 5)) s
   ├─ Datos/Capacidades.swift           [N] I0→M1 · memo del 403 origin_forbidden
   ├─ Datos/Identidad.swift             [N] I0→M1 · IdentidadDispositivo.id(token:) = prefijo del token antes del punto (a7 §7)
   ├─ Datos/Reloj.swift                 [N] I0→M1 · Reloj, RelojSistema, RelojDesplazado
   ├─ Agenda/RelojMadrid.swift          [M] M5 · de AgendaViewModel, revalidado con vectores
   ├─ Agenda/DominioAgenda.swift        [N] M5 · agenda/domain.ts (absorbe ReglasAgenda y FormatoAgenda rescatadas)
   ├─ Agenda/TarjetasAgenda.swift       [N] M5 · agenda/cards.ts
   ├─ Agenda/Destapado.swift            [N] M5 · score-reveal.ts + goles (GOAL_MS 1200); absorbe ReglasPalco
   ├─ Agenda/Marcadores.swift           [N] M5 · scoresWanted, scoresInterval (8/45 s), paintableScore
   ├─ Agenda/SenalPartido.swift         [N] M5 · useMatchSignal: ventana −45/+120, preheat/scan → señal
   ├─ Agenda/OpcionesPartido.swift      [N] M5 · menuFor (a3 §6.5)
   ├─ Biblioteca/ModeloBiblioteca.swift [M] M5 · de ReglasBiblioteca, revalidado (library/model.ts)
   ├─ Biblioteca/EnAntena.swift         [N] M5 · library/on-air.ts
   ├─ Biblioteca/Zapping.swift          [N] M5 · player/zapping.ts (lo consume M3)
   ├─ Biblioteca/OpcionesCanal.swift    [N] M5 · a5 §3.9
   ├─ Busqueda/ModeloBusqueda.swift     [N] M5 · search/model.ts (cleanQuery, searchPhase, isHashOrLink)
   ├─ Gustos/ModeloGustos.swift         [M] M5 · de GustosEditables, revalidado (preferences/model.ts)
   ├─ Fuentes/ReglasFuentes.swift       [M] M3 · movido de Features/Sources, revalidado (sources/model.ts)
   ├─ Fuentes/OpcionesFuente.swift      [N] M3 · menú del cartel (a4 §5.7)
   ├─ Reproduccion/EstadoVisible.swift  [N] M3 · player/status.ts (statusFor, liveButton, stageMessage, IDLE_MESSAGES)
   ├─ Reproduccion/OpcionesReproductor.swift [N] M3 · las 14 opciones de a4 §5.6 y su háptica
   ├─ Reproduccion/TextosReproductor.swift [N] M3 · catálogo de textos del reproductor y de la sesión de fuentes
   ├─ Listas/ModeloListas.swift         [N] M7 · directories/model.ts
   ├─ Donde/ModeloDonde.swift           [M] M7 · de DondeSuena, revalidado (where-playing/model.ts)
   ├─ Salud/ModeloSalud.swift           [N] M7 · health/model.ts + summarizeEngine
   ├─ Dispositivos/ModeloDispositivos.swift [N] M7 · devices/model.ts
   └─ Dispositivos/OpcionesDispositivo.swift [N] M7 · a6 §8.9, §8.10.2
```

### 1.5 `Sources/Player` (M3)

```
Sources/Player/
├─ MotorVideo.swift                     [Q]
├─ MotorAVPlayer.swift                  [M] primer fotograma = isReadyForDisplay && reproduciendo && avance ≥ 0,05 s (a8 §3.11.7); sin KVO
├─ MaquinaConexion.swift                [Q][L]
├─ Directo.swift                        [Q][L]
├─ TiposReproduccion.swift              [N][L] CanalReproducible y ContextoPartido (de ServicioReproduccion.swift), OrigenReproduccion,
│                                           MotivoParada, FalloFuente e IntentoReconexion (de Reproductor.swift): se mueven sin cambios
├─ ServicioReproduccion.swift           [M] IdentidadVisor: `v_` + 14 base64url, uno por arranque de proceso y solo en memoria (a7 §7)
├─ Reproductor.swift                    [M] fuera expandido/superficiesGrandes/visibleEnMini/vista/expandir/minimizar/superficieGrande;
│                                           textos de la web; modo desde aceneo-pb
├─ ControlesSistema.swift               [M] Now Playing y mandos de la web (detener, −30 s, anterior/siguiente solo con zapping)
├─ SuperficieVideo.swift                [M] PrioridadHueco mini < teatro < inmersivo < vuelo; GestorPiP; BotonAirPlay; Orientacion
├─ DetectorRutas.swift                  [N] AVRouteDetector por notificación (enseñar AirPlay solo con rutas)
├─ PresentacionReproductor.swift        [N] I0→M3 · lugar del vídeo, controles, autoocultado 3,2 s, pantalla completa, datos técnicos, cortes
├─ Fuentes/SesionFuentes.swift          [M] I0→M3 · de CentroPartidoModelo: session.ts entero + «Otras fuentes» (calcado de la web, §0.0 punto 1)
├─ GestosReproductor.swift              [B] (la forma pasa a Core/Reglas/Gestos, con los números de la web)
└─ ReproductorVistas.swift              [B]
```

### 1.6 `Sources/Palco` (P)

```
Sources/Palco/
├─ Tokens/ColoresPalco.generado.swift   [N][G] enum Palco (a1 §2.1-2.2) + PalcoMezcla (a1 §2.3-2.4, a3 §1.3, a6 §0.1)
├─ Tokens/ColorDinamico.swift           [N] Color(claro:oscuro:), Color(hex:), UIColor(hex:alfa:), RGB.color
├─ Tokens/Medidas.swift                 [N] S, R, Capa, Alturas
├─ Tokens/Sombras.swift                 [N] SombraPalco, .sombra, .bordeInterior, .brilloSuperior (extensión negativa)
├─ Tokens/Movimiento.swift              [N] muelles de la web y su versión reducida
├─ Tipografia/Mona.swift                [N] Mona (palco | campos) y Martian, ejes siempre, caché con candado
├─ Tipografia/EstiloTexto.swift         [N] estilos como datos, .estilo(), .altoDeLinea()
├─ Iconos/TrazosIcono.generado.swift    [N][G] los 52 Path en la rejilla 24 (trazo y relleno)
├─ Iconos/IconoPalco.swift              [N] FormaIcono + IconoPalco (modo relleno + trazo)
├─ Iconos/IconoImagen.swift             [N] UIImage plantilla para Menu y contextMenu (ImageRenderer, caché)
├─ Cristal/Cristal.swift                [N] TipoCristal, CristalPalco.vidrio/solido, .cristal() (ÚNICO .glassEffect( de la app)
├─ Haptica/Haptica.swift                [N] Haptica, PulsoHaptico, TipoHaptico.feedback
├─ Haptica/HapticaRaiz.swift            [N] el ÚNICO .sensoryFeedback( de la app
├─ Entorno/ValoresEntorno.swift         [N] I0→P · los @Entry (§2.2.10)
├─ Gestos/DeslizamientoHorizontal.swift [N] pan horizontal con bloqueo de eje que cede a carriles y al borde
├─ Gestos/SubeConLaBarra.swift          [N] sonda scrollsToTop (a2 §27.5)
├─ Componentes/                         [N] una primitiva por fichero, firmas de §2.2.11:
│    EstiloPulsar · BotonPalco · BotonIcono · Superficies (.tarjeta/.panel/.islaOscura) · Chip · Capsula · MedidorSenal ·
│    AnilloSenal · PuntoDirecto · Onda · Num · BarraProgreso · MarcaEquipo · ImagenServidor · MarcaCanal ·
│    PastillaCompeticion · TarjetaVersus · BloqueEscudos · FilaEquiposPartido · CarrilCarteles · Segmentado ·
│    Interruptor · CampoTexto · EstadoVacio · Esqueleto · CabeceraVista · Flujo · ContenidoHoja · ToastVista ·
│    LineaEstadoVista · Tecla · SegundoToque
├─ Galeria/SistemaView.swift            [N] galería «Sistema» (a1 §11; 7 toques en «Versión»; -AceNeoSistema en Debug)
└─ Galeria/LaboratorioView.swift        [N] #if DEBUG · banco de pruebas de la fase 0 (§4.1.4); -AceNeoLaboratorio
```

### 1.7 `Sources/Armazon` (M4)

```
Sources/Armazon/
├─ AppShell.swift                       capas del ZStack (§2.4.6), medida de la ventana, teclado
├─ Navegador.swift                      [I0→M4] estado de ruta
├─ CapaPestanas.swift                   pestañas vivas, fundido ±16 por sentido, vistaActiva y subeConLaBarra por pestaña
├─ CapaPartido.swift                    capa del teatro: zoom de ida, borde izquierdo, arrastre del vídeo, vuelta
├─ CapaInmersiva.swift                  contenedor del inmersivo (z 100), fuera de cualquier gesto de volver
├─ CapaMini.swift                       posición (Maquetacion.marcoMini) y entrada del mini
├─ CapaAvisos.swift                     toasts: posición, entrada y salida, recolocación con muelle, inmersivo
├─ CapaVuelo.swift                      vuelo de escudos (plusLighter) + VueloVideo (z 45)
├─ VueloVideo.swift                     el hueco `.vuelo` que viaja escenario → mini (ÚNICO VistaVideo fuera de Pantallas)
├─ TransicionTeatro.swift               [I0→M4] marcos publicados, progreso, secuencias de ida y vuelta
├─ BordeAtras.swift                     UIScreenEdgePanGestureRecognizer (a2 §27.4)
├─ BarraPestanas.swift                  la barra de la web: glassEffect, píldora, 4 destinos
├─ BarraSuperior.swift                  horizontal ≥ 768 (a2 §16.1)
├─ VeloInferior.swift
├─ Avisos.swift                         [I0→M4] el notify() de la web (toasts + línea de estado)
├─ Hojas.swift                          [I0→M4] Hoja, CentroHojas y el ÚNICO .sheet( de la app
├─ Menus.swift                          [I0→M4] AccionMenu, ContenidoMenu, BotonMas y el ÚNICO .contextMenu( de la app
├─ EstadosGlobales.swift                backend no disponible, parte visible del acceso perdido, servidor 0.8.0
├─ ControlOrientacion.swift             pantalla completa y vuelta a vertical segura (a2 §27.8)
└─ IdentificadoresUI.swift              [I0→M4] enum IDUI (compilado también en AceNeoUITests)
```

### 1.8 `Sources/Pantallas`

Regla: **una `View` por fichero**; subvistas `private` de menos de 30 líneas pueden ir en el mismo fichero.

```
Sources/Pantallas/
├─ Emparejar/                           (M7) a2 §22, §23.3
│  ├─ PantallaEmparejar.swift           vertical (cartel + columna) y horizontal (dos columnas)
│  ├─ CartelCamara.swift                cámara a sangre, velo con ventana, marco, cápsula de indicación, cabecera blanca
│  ├─ VentanaEscaner.swift              Shape par-impar + cuatro esquinas
│  ├─ BloqueSinCamara.swift             permiso denegado, restringida, sin cámara
│  ├─ TarjetaCodigo.swift               «Escribir el código», direcciones, «Emparejar»
│  ├─ CeldasCodigo.swift                seis cifras en celdas de 0,72 em con cursor
│  ├─ FilaAvisoEmparejar.swift          fila de error (fail 14 %) y de acceso perdido (weak 14 %)
│  └─ ContenidoOtroServidor.swift       hoja «¿Emparejar con otro servidor?» (a2 §22.8)
├─ Agenda/                              (M5) a3
│  ├─ AgendaView.swift                  ScrollView + .refreshable; publica EstadoVentana.heroeBajoBarra
│  ├─ ModeloAgenda.swift                día, modo, datos, sondeos atados a vistaActiva
│  ├─ Heroe.swift                       versus XL a sangre, velo de cabecera; publica el origen del vuelo
│  ├─ CabeceraAgenda.swift              «Agenda» sobre el héroe (isla oscura) + actualizar + motor/«Modo demo»
│  ├─ BarraHeroe.swift                  «Ver ahora», cápsula «Marcador», dónde se emite
│  ├─ TiraDias.swift                    pastillas, imán al centro, subir a la tira al cambiar de día
│  ├─ FilaFiltro.swift                  «Para ti / Todos», lápiz, «n en directo»
│  ├─ TarjetaPrimerUso.swift
│  ├─ PanelPartidos.swift               grupos por competición, deslizar para cambiar de día, escalonado de 12
│  ├─ GrupoCompeticion.swift            cabecera + carril
│  ├─ TarjetaPartido.swift              versus md + progreso + línea; menú contextual; origen del vuelo
│  ├─ CapsulaMarcadorTarjeta.swift      tapado/destapado (paleta al destapar, rueda al cambiar)
│  ├─ PieAgenda.swift                   pie y resumen accesible
│  ├─ EstadosAgenda.swift               cargando, error, vacíos (a3 §10)
│  └─ ContenidoGustos.swift             hoja «¿Qué fútbol te mueve?» (a3 §13)
├─ Canales/                             (M5) a5 §2-§3
│  ├─ CanalesView.swift · ModeloCanales.swift · EmitiendoAhora.swift · CartelCanal.swift · PanelBiblioteca.swift ·
│  │  FilaCanal.swift · CabeceraCategoria.swift · TarjetaListaActiva.swift · PieBiblioteca.swift
│  ├─ ContenidoRenombrar.swift          hoja «Renombrar canal»
│  └─ ContenidoGuardarFavorito.swift    hoja «Guardar favorito»
├─ Buscar/                              (M5) a5 §4
│  └─ BuscarView.swift · ModeloBuscar.swift (espera 450 ms, fases, anuncios) · ResultadoBusqueda.swift · EnlaceDetectado.swift
├─ Pegar/
│  └─ ContenidoPegar.swift              (M5) hoja «Reproducir otro hash» (a5 §5)
├─ Partido/                             (M6) a4
│  ├─ TeatroView.swift                  escenario fijo + ScrollView (partido o canal suelto)
│  ├─ EscenarioVideo.swift              marco y capas (a4 §5.1), variante inmersiva; ÚNICO VistaVideo del teatro
│  ├─ CapaToquesVideo.swift             UIView: toque, doble toque (el simple exige que falle el doble), arrastre con eje bloqueado
│  ├─ ControlesVideo.swift              velo de 6 paradas, filas, autoocultado
│  ├─ FilaSuperiorControles.swift       minimizar | cápsula del canal (inmersivo tableta) · marcador · favorito/PiP/más
│  ├─ FilaInferiorControles.swift       pausa 52 · [detener] · −30 · silencio · [Directo · AirPlay · pantalla completa]
│  ├─ BotonDirectoVideo.swift           off / live / behind / resume (a4 §5.4)
│  ├─ CapsulaMarcadorVideo.swift        a4 §6
│  ├─ CapsulaCanalSonando.swift         ecualizador + canal (inmersivo ≥ 768)
│  ├─ CapsulaEstadoVideo.swift          línea de estado sobre el vídeo (a2 §8.4, a4 §7)
│  ├─ PanelMensajeVideo.swift           stageMessage, spinner, rótulo de demo
│  ├─ CorteNegro.swift                  560 ms (opacidad 1 hasta el 55 %, luego ease-out) con keyframes
│  ├─ VistaPreviaVideo.swift            tesela + título + cápsula de fase (vista previa del menú del vídeo)
│  ├─ VarianteEscenario.swift           reglas por ancho del marco (369/419/479/579) y «compacto»
│  ├─ CabeceraPartido.swift             kicker + FilaEquiposPartido (destino del vuelo)
│  ├─ CabeceraCanal.swift               a4 §16
│  ├─ PestanasTeatro.swift              «Fuentes n · Partido · Datos técnicos», fijadas bajo el vídeo
│  ├─ PanelFuentes.swift                cabecera, progreso del comprobador, «Ninguna da señal», plegadas
│  ├─ BarraEmitiendo.swift              ‹ › y deslizar
│  ├─ CartelFuente.swift                cartel + menú contextual + accessibilityActions
│  ├─ InspectorFuente.swift             acciones de la fuente activa
│  ├─ OtrasSenales.swift                «Otras fuentes» (calcado de la web, §0.0 punto 1) (canal suelto, añadido de Isma)
│  ├─ PanelPartido.swift                marcador grande, competición, dónde se emite (a4 §14)
│  ├─ PanelDatosTecnicos.swift          pestaña y panel sobre el vídeo (a4 §15)
│  ├─ FichaCanal.swift                  pestaña «Canal» (a4 §16)
│  ├─ EstadosPartido.swift              esqueleto, «ya no está», error (a4 §17)
│  ├─ ContenidoReportar.swift           hoja «Reportar fuente» (a4 §13.2)
│  └─ ContenidoEncontrarCanal.swift     hoja «Encontrar canal» (a4 §13.3)
├─ Mini/
│  └─ MiniReproductor.swift             (M6) banda/tarjeta, gestos en dos ejes; ÚNICO VistaVideo del mini
└─ Ajustes/                             (M7) a6
   ├─ AjustesView.swift · ModeloAjustes.swift · IndiceChips.swift · TarjetaSeccion.swift
   ├─ SeccionListas.swift · SeccionTuFutbol.swift · SeccionReproduccion.swift · RadioModo.swift · SeccionDonde.swift ·
   │  SeccionApariencia.swift · SeccionDispositivos.swift · PanelEmparejarDispositivo.swift ·
   │  ModeloEmparejarDispositivo.swift · QRPalco.swift · FilaDispositivo.swift · SeccionSalud.swift · SeccionMotor.swift ·
   │  SeccionAcercaDe.swift · AvisoVersion.swift
   └─ ContenidoAyuda.swift              hoja «Atajos de teclado» (Gestos + gestos nativos · Teclado · Ratón)
```

### 1.9 `Sources/Debug`, `Sources/Sonda` y lo que desaparece

```
Sources/Debug/                          (todo #if DEBUG; M2 salvo lo indicado)
├─ DemoNucleo/                          [L]
│  ├─ EstadoDemo.swift                  biblioteca, preferencias, ajustes, dispositivos, trabajos (final class + Mutex)
│  ├─ RutasDemo.swift                   responder(petición, estado, ahora) → estado HTTP, cuerpo, espera (0/120/260 ms)
│  ├─ AgendaDemo.swift                  ancla de 5 min, demo-1…13, días siguientes (agenda/demo-data.ts)
│  ├─ MarcadoresDemo.swift              minuto y goles según el reloj
│  ├─ FuentesDemo.swift                 resolución por partido, comprobador cada 1 350 ms, rebuscar, reportes, vínculos
│  ├─ BuscadorDemo.swift                14 canales (search/demo.ts)
│  ├─ SaludDemo.swift                   salud y registro con «hace N min» (health/demo.ts)
│  ├─ DispositivosDemo.swift            emparejar (código 482913), lista, revocar
│  ├─ HashesDemo.swift                  demoHash (FNV-1a + xorshift32), fakeHash
│  └─ SemillasDemo.generado.swift       [G] los datos estáticos de la demo web en JSON base64
├─ ServidorDemo.swift                   URLProtocol que llama a RutasDemo; OpcionesSimulado; ServidorDemo.entorno(opciones:)
├─ SSEDemo.swift                        SSE simulado para los flujos con tiempo real (-AceNeoServidorSimulado)
├─ MotorSimulado.swift                  [Q] M3 · señal a 1,8 s; «caíd» falla; estadísticas cada 1,5 s
├─ ImagenDemo.swift                     campo de fútbol de player/index.tsx › DemoPicture en Canvas + rótulo de demo
├─ EscenasCaptura.swift                 I2 · prepara cada vista de final/ sin pasos de interfaz (-AceNeoEscena)
└─ ServidorSimulado.swift               [B] M2 · sigue en la fase 0 (la demo provisional delega en él); M2 lo borra al acabar ServidorDemo
Sources/Sonda/                          I0 · canarios de API (§5.3). BORRADO al cerrar la fase 0 (25-sep, §5.3.1)
Sources/Design/                         [B] entero
Sources/Features/                       [B] entero (lo rescatable está en §1.11)
```

### 1.10 `Tests`

Las pruebas que se mueven siguen en **XCTest** (como hoy). Las **nuevas** pruebas puras usan **Swift Testing**
(`@Test(arguments:)` encaja con los vectores); las dos corren en Xcode y en Linux.

```
Tests/AceNeoTests/
├─ Ayudas.swift                         [M] MockURLProtocol, ComparadorJSON, LlaveroSimulado, Prueba, Contador, conPlazo
│                                           (Fixtures sale a Puros/Soporte)
├─ Vectores/                            [G] vectores-<área>.json (vectores-dominio.json se conserva) + demo/demo-<vista>.json (golden)
│                                           nombres únicos: Xcode copia los recursos aplanados en la raíz del bundle
├─ Puros/                               [L] también en Linux; cabecera: #if SWIFT_PACKAGE @testable import NucleoPuro #else @testable import AceNeo #endif
│  ├─ Soporte/Fixtures.swift            [M] I0 · enum Fixtures (de Ayudas) + enum Vectores (§1.13.2)
│  ├─ Nucleo/                           M1 · EsperaSSETests, EfectosEventoTests, CapacidadesTests, IdentidadTests, RelojTests, ServidoresTests (varias u=)
│  ├─ Dominio/                          M2 · VectoresDominioTests (movido)
│  ├─ Comunes/                          M2 · Color, Equipos, TonoCanal, Formatos, Gestos, Haptica (+ SitiosHapticos), ColaToasts, LineaEstado, Redaccion
│  ├─ Armazon/                          M4 · DestinoTests, MaquetacionTests (390×844, 375×667, 375×812, 402×874, 844×390, 667×375),
│  │                                         GeometriaVueloTests, MigracionClavesTests
│  ├─ Agenda/ · Biblioteca/ · Busqueda/ · Gustos/          M5 · vectores + casos de domain.test.ts, cards.test.ts, score-reveal.test.ts…
│  ├─ Fuentes/ · Reproduccion/          M3 · ReglasFuentesTests (movido + vectores de model.test.ts), EstadoVisibleTests, OpcionesTests, TextosTests
│  ├─ Listas/ · Donde/ · Salud/ · Dispositivos/            M7
│  └─ Demo/                             M2 · DemoGoldenTests
├─ Nucleo/                              M1 · APIClientTests, SSETests, LlaveroTests, EmparejamientoTests, FixturesTests, CacheYErroresTests,
│                                            EscudosDecodificacionTests, CacheImagenesTests, ConsultaTests, DatosAppTests, TiempoRealTests,
│                                            RepartidorTests, SesionAppTests, VigiaVersionTests; InfoPlistTests (I0)
├─ Reproduccion/                        M3 · ReproductorTests, MaquinaYDirectoTests, MotorAVPlayerTests, SistemaTests, SuperficieYPiPTests,
│                                            SesionFuentesTests, PresentacionReproductorTests
├─ Palco/                               P · TokensTests, FuentesTests, IconosTests, NumTests, EstiloTextoTests
├─ Armazon/                             M4 · NavegadorTests, CentroHojasTests, AvisosTests, EstadoVentanaTests, RaizTests
├─ Teatro/                              M6 · VarianteEscenarioTests
└─ Ajustes/                             M7 · ModeloEmparejarTests, ModeloEmparejarDispositivoTests, QRPalcoTests
Tests/AceNeoUITests/
├─ Ayudas/AyudasUI.swift                [M] I0→M4 · elementoUI, conTextoUI, arrastrar, sePinta; tocarPestana por IDUI
├─ Ayudas/ServidorDePruebas.swift       [Q]
├─ Flujos/FlujoArmazonUITests.swift     M4
├─ Flujos/FlujoAgendaUITests.swift · FlujoCanalesUITests.swift · FlujoBuscarPegarUITests.swift      M5
├─ Flujos/FlujoTeatroUITests.swift · FlujoMiniUITests.swift                                          M6
├─ Flujos/FlujoEmparejarUITests.swift · FlujoAjustesUITests.swift                                    M7
├─ Palco/LaboratorioUITests.swift · SistemaUITests.swift                                             P
├─ Capturas/CapturasPalcoUITests.swift  I2
├─ ServidorRealUITests.swift            [M] I1 · E2E contra el backend real (pila E2E)
└─ EmparejamientoUITests · ReproduccionUITests · CapturasUITests      [B]
```

### 1.11 Qué se borra y qué se rescata antes (fase 0.2, un solo agente)

**Código que se rescata** antes de borrar: `AgendaViewModel.RelojMadrid/ReglasAgenda/FormatoAgenda` → `Core/Reglas/Agenda`
(se revalidan con vectores); `ReglasPalco` (anti-spoiler, goles) → `Core/Reglas/Agenda/Destapado.swift`; `ReglasBiblioteca`
→ `Core/Reglas/Biblioteca/ModeloBiblioteca.swift`; `CentroPartidoModelo` → `Player/Fuentes/SesionFuentes.swift`;
`HermanasModelo` (en `EscenarioView.swift`) → dentro de `SesionFuentes` («Otras fuentes» (§0.0)); `ReglasFuentes` →
`Core/Reglas/Fuentes/ReglasFuentes.swift`; `PairingViewModel` → `Core/Emparejar/ModeloEmparejar.swift`; `QRScannerView` →
`Core/Emparejar/EscanerQR.swift`; `BuscarModelo` (en `BuscarView.swift`) → `Pantallas/Buscar/ModeloBuscar.swift`;
`enum DondeSuena` → `Core/Reglas/Donde/ModeloDonde.swift`; `TipoGusto`/`GustosEditables` → `Core/Reglas/Gustos/ModeloGustos.swift`;
`DisposicionFlujo` → base de `Palco/Componentes/Flujo.swift`; la lógica de `RootView.onOpenURL` → `SesionApp.abrir(enlace:)`.

**Pruebas que se mueven** (clase a clase; lo que no está en la tabla se queda como está en su subcarpeta):

| Fichero de hoy | Clase | Destino |
|---|---|---|
| `AgendaYBibliotecaTests.swift` | `ReglasAgendaTests`, `ReglasBibliotecaTests`, `DondeSuenaTests`, `GustosEditablesTests` | `Puros/Agenda/`, `Puros/Biblioteca/`, `Puros/Donde/`, `Puros/Gustos/` |
| `CacheYFormatoTests.swift` | `CacheTests`, `CatalogoErroresTests` | `Nucleo/CacheYErroresTests.swift` |
| | `FormatoAgendaTests` | `Puros/Agenda/FormatoAgendaTests.swift` |
| `PalcoTests.swift` | `AntiSpoilerTests`, `RegistroGolesTests`, `SeccionesAgendaTests` | `Puros/Agenda/` |
| | `ResumenFuentesTests` | `Puros/Fuentes/` |
| | `EscudosDecodificacionTests`, `CacheImagenesTests` | `Nucleo/` (usan ComparadorJSON, MockURLProtocol y UIKit) |
| | `ColoresVersusTests`, `ChipHoraTests`, `CapsulaSenalTests` | se borran (su código se borra; los sustituyen Equipos, TonoCanal y MedidorSenal) |
| `ReglasFuentesTests.swift` | `ReglasFuentesTests` | `Puros/Fuentes/` |
| `VectoresDominioTests.swift` | `VectoresDominioTests` | `Puros/Dominio/` (`Bundle(for: MockURLProtocol.self)` → `Vectores.datos`) |
| `ReproductorVisibleTests.swift` | `SuperficieUnicaTests`, `PiPTests` | `Reproduccion/SuperficieYPiPTests.swift` (prioridades nuevas) |
| | `GestosReproductorTests`, `VistaReproductorTests` | se borran (los sustituyen `Puros/Comunes/GestosTests` y `PresentacionReproductorTests`) |
| `CentroPartidoTests.swift` | `CentroPartidoTests` | `Reproduccion/SesionFuentesTests.swift` (adaptado a `EntornoSesionFuentes`) |
| el resto de `Tests/AceNeoTests/*.swift` | todas | a `Nucleo/` o `Reproduccion/` sin cambios |

**Se borran**: `Sources/App/{AceNeoApp,AppModel,RootView}.swift`; `Sources/Design/**`; `Sources/Features/**`;
`Sources/Player/{ReproductorVistas,GestosReproductor}.swift` (unas 10 100 líneas);
`Resources/Assets.xcassets/Colores/*` salvo `Bg`; la variante clara de `Marca.imageset`; los ficheros de pruebas vaciados
por la tabla anterior; `Tests/AceNeoUITests/{EmparejamientoUITests,ReproduccionUITests,CapturasUITests}.swift` (540 líneas);
`scripts/generar-vectores.mjs` (cuando `vectores/dominio.ts` dé la misma salida).

### 1.12 Qué se reutiliza y qué hay que modernizar

| Pieza | Se reutiliza | Cambios obligatorios (a8 §3.11) | Test que cambia |
|---|---|---|---|
| `Endpoint`, `APIClient` | sí | plazo **total** con carrera `withThrowingTaskGroup` petición ↔ `Task.sleep`; `CancellationError` nunca se enseña; `.reloadRevalidatingCacheData` en GET y `.reloadIgnoringLocalCacheData` en el resto; reintento con la otra dirección **solo en GET** (`guardarPreferencias` deja de ser idempotente); 401 ignorado mientras `SesionApp.olvidando` | `APIClientTests` (servidor que gotea bytes, PUT que no se repite), `EndpointTests` |
| `Rutas` | sí | plazos de `PlazosWeb.generado` (12 s por defecto; fútbol 14, búsqueda 15, stream 60, sync 50, reinicio 20, scans 5, resolve 20/30, ping 4; SSE 45 s de inactividad); + las 6 rutas 0.8.1 | `EndpointTests` |
| `APIError` | sí | textos del cliente web (a7 §3.3); `reintentable` (red, plazo, ≥ 500, 429); `describirFallo` | `CatalogoErroresTests` |
| `SSEClient`, `SSEParser` | sí | esperas de `EsperaSSE` (3, 6, 12, 24, 48, 60… s); el último id lo guarda `TiempoReal` y se reanuda con él | `SSETests` |
| `ServerResolver` | tal cual | — (lo invalida `VigiaRed`) | — |
| `Servidores`, `Emparejamiento` | sí | `PairingLink.servidores: [URL]` (todas las `u=`; la primera para el canje); «Red de casa» | `EmparejamientoTests` |
| `Llavero`, `DiskCache` | tal cual | — | — |
| `CacheImagenes` | sí | `byPreparingForDisplay()` | `CacheImagenesTests` |
| Modelos | sí | + `PairingCreateBody`, `SettingsUpdateBody` | `FixturesTests` |
| `Canales`, `ParaTi` | sí | fuera `nonisolated(unsafe)` | `VectoresDominioTests` |
| `MotorAVPlayer` | sí | primer fotograma con `isReadyForDisplay` (cierre `listoParaPintar` que lee la capa; sin KVO) | `MotorAVPlayerTests`, `ReproductorTests` |
| `Reproductor` | sí | fuera el estado de presentación; mensajes de a8 §3.11.8; modo en `aceneo-pb` | `ReproductorTests` |
| `ServicioReproduccion` | sí | `IdentidadVisor`: `v_` + 14 base64url por proceso; tipos de valor a `TiposReproduccion.swift` | `MaquinaYDirectoTests` |
| `ControlesSistema` | sí | título = canal ‖ «Ace Player Neo», artista = subtítulo, álbum «Ace Player Neo», carátula `Marca`; `stopCommand`, `skipBackwardCommand [30]`; anterior/siguiente solo con zapping; `nil` en reposo y en error | `SistemaTests` |
| `SuperficieVideo`, `GestorPiP`, `BotonAirPlay`, `Orientacion` | sí | `PrioridadHueco` nuevo; conformidades aisladas `@MainActor` en los delegados | `SuperficieYPiPTests` |
| `CentroPartidoModelo` | como base | → `SesionFuentes`: sin `unowned let app: AppModel` (protocolo `EntornoSesionFuentes`), port completo de `session.ts` | `SesionFuentesTests` |
| `PairingViewModel`, `QRScannerView` | sí | estados de cámara, canje automático, pausa de 60 s, cámara embebida | `ModeloEmparejarTests` |
| `MotorSimulado` | tal cual | — | — |
| `Entorno`, `ModoEjecucion` | sí | argumentos nuevos (§3.3.1); `Entorno.actual()` usa `ServidorDemo` | — |
| Ayudas de tests y de UITests | sí | `Fixtures` a `Puros/Soporte`; `tocarPestana` por `IDUI` | — |

### 1.13 Configuración

#### 1.13.1 `project.yml`

```yaml
name: AceNeo
options:
  bundleIdPrefix: es.ismaeloul
  deploymentTarget:
    iOS: "26.0"
  developmentLanguage: es
  createIntermediateGroups: true
  groupSortPosition: top
  generateEmptyDirectories: false

configFiles:
  Debug: Config/AceNeo.xcconfig
  Release: Config/AceNeo.xcconfig

settings:
  base:
    SWIFT_VERSION: "6.0"                 # modo de lenguaje 6 con el compilador 6.2 de Xcode 26.6, como hoy
    SWIFT_STRICT_CONCURRENCY: complete
    IPHONEOS_DEPLOYMENT_TARGET: "26.0"
    TARGETED_DEVICE_FAMILY: "1"          # solo iPhone
    ENABLE_USER_SCRIPT_SANDBOXING: YES
    LOCALIZATION_PREFERS_STRING_CATALOGS: YES
    DEAD_CODE_STRIPPING: YES
    CODE_SIGN_STYLE: Automatic
    DEVELOPMENT_TEAM: ""
    # NUNCA: SWIFT_DEFAULT_ACTOR_ISOLATION ni SWIFT_APPROACHABLE_CONCURRENCY (cambian la semántica del núcleo)
  configs:
    Debug:
      SWIFT_OPTIMIZATION_LEVEL: "-Onone"
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
      - path: Resources
    settings:
      base:
        PRODUCT_NAME: AceNeo
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID)
        INFOPLIST_FILE: Config/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: AccentColor
        ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS: NO
        ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS: NO
        ENABLE_PREVIEWS: NO                # sin Xcode local no sirven
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
    dependencies:
      - target: AceNeo
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
    dependencies:
      - target: AceNeo
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: $(ACE_BUNDLE_ID).uitests
        GENERATE_INFOPLIST_FILE: YES
        TEST_TARGET_NAME: AceNeo

schemes:
  AceNeo:
    build:
      targets:
        AceNeo: all
        AceNeoTests: [test]
        AceNeoUITests: [test]
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

La demo no necesita exclusiones en Release: todo `Sources/Debug/**` va bajo `#if DEBUG` y sus datos son Swift generado,
no recursos. `IdentificadoresUI.swift` no puede depender de nada de la app (solo `enum IDUI` con `static let` y
`static func`), porque también compila en el objetivo de UITests.

#### 1.13.2 `Package.swift` espejo (Linux)

XcodeGen no lo ve y `xcodebuild` siempre recibe `-project AceNeo.xcodeproj`. Compila **en su sitio** los ficheros [L].

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "NucleoPuro",
    platforms: [.iOS(.v26), .macOS(.v26)],          // coherente con la app; Linux lo ignora
    products: [.library(name: "NucleoPuro", targets: ["NucleoPuro"])],
    targets: [
        .target(
            name: "NucleoPuro",
            path: "Sources",
            sources: [
                "Core/Models",
                "Core/Dominio",
                "Core/Reglas",
                "Core/Networking/Endpoint.swift",
                "Core/Networking/APIError.swift",
                "Core/Networking/ErrorCatalog.swift",
                "Core/Networking/PlazosWeb.generado.swift",
                "Core/Networking/RutaID.generado.swift",
                "Core/Networking/SSEParser.swift",
                "Core/Auth/Servidores.swift",
                "Player/MaquinaConexion.swift",
                "Player/Directo.swift",
                "Player/TiposReproduccion.swift",
                "App/MigracionClaves.swift",
                "Debug/DemoNucleo",
            ],
            swiftSettings: [.swiftLanguageMode(.v6), .define("DEBUG")]
        ),
        .testTarget(
            name: "NucleoPuroTests",
            dependencies: ["NucleoPuro"],
            path: "Tests/AceNeoTests",
            sources: ["Puros"],
            resources: [.copy("Vectores")],
            swiftSettings: [.swiftLanguageMode(.v6), .define("DEBUG")]
        ),
    ]
)
```

- `.define("DEBUG")` hace que `Debug/DemoNucleo` (bajo `#if DEBUG`) compile y se pruebe también en Linux.
- Los ficheros de red [L] empiezan con `import Foundation` + `#if canImport(FoundationNetworking)` / `import FoundationNetworking` / `#endif`.
- `Puros/Soporte/Fixtures.swift` es la única puerta a los datos de prueba:

```swift
import Foundation

/// Ejemplos de @ace/shared (packages/shared/fixtures).
enum Fixtures {
    static func datos(_ ruta: String) throws -> Data { try Data(contentsOf: raiz.appendingPathComponent(ruta)) }
    static func nombres(_ carpeta: String) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: raiz.appendingPathComponent(carpeta).path)
            .filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
    }
    #if SWIFT_PACKAGE
        /// apps/ios/Tests/AceNeoTests/Puros/Soporte/Fixtures.swift → ace-player-neo/packages/shared/fixtures
        static var raiz: URL {
            var url = URL(fileURLWithPath: #filePath)
            for _ in 0..<7 { url.deleteLastPathComponent() }   // 7 niveles, no 6 (§5.3.1)
            return url.appendingPathComponent("packages/shared/fixtures")
        }
    #else
        static var raiz: URL {
            guard let url = Bundle(for: MarcaBundle.self).url(forResource: "fixtures", withExtension: nil) else {
                fatalError("La carpeta fixtures no está en el bundle de los tests (revisa project.yml)")
            }
            return url
        }
    #endif
}

/// Vectores y golden generados (Tests/AceNeoTests/Vectores).
enum Vectores {
    static func datos(_ nombre: String) throws -> Data {
        #if SWIFT_PACKAGE
            let base = Bundle.module.resourceURL!.appendingPathComponent("Vectores")
            for sub in ["", "demo"] {
                let url = base.appendingPathComponent(sub).appendingPathComponent(nombre + ".json")
                if FileManager.default.fileExists(atPath: url.path) { return try Data(contentsOf: url) }
            }
            throw CocoaError(.fileNoSuchFile)
        #else
            guard let url = Bundle(for: MarcaBundle.self).url(forResource: nombre, withExtension: "json") else {
                throw CocoaError(.fileNoSuchFile)
            }
            return try Data(contentsOf: url)
        #endif
    }
}

#if !SWIFT_PACKAGE
    private final class MarcaBundle {}
#endif
```

- En el PC, desde `ace-player-neo/` (monta el monorepo entero para que se vean los fixtures):
  `docker run --rm -v "${PWD}:/w" -w /w/apps/ios swift:6.2-noble bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tzdata >/dev/null && swift test"`
  (lo envuelve `scripts/probar-linux.ps1`; `tzdata` hace falta para `Europe/Madrid`).
- Si `.v26` no existe en PackageDescription 6.2 (el trabajo de Linux falla en segundos), se quita `platforms`: Linux lo ignora.

#### 1.13.3 `Info.plist` y `AceNeo.xcconfig`

| Clave | Valor |
|---|---|
| `UIAppFonts` | `PalcoSans-Variable.ttf`, `MonaSans-Variable.ttf`, `MartianMono-Variable.ttf` (XcodeGen copia los recursos sueltos en la raíz del bundle; `InfoPlistTests` comprueba `Bundle.main.url(forResource:)` y los tres nombres PostScript) |
| `UIApplicationSceneManifest` | `UIApplicationSupportsMultipleScenes = false`; la escena la declara el propio plist (`UISceneConfigurations` → `UIWindowSceneSessionRoleApplication` → «Principal» con `UISceneDelegateClassName = $(PRODUCT_MODULE_NAME).SceneDelegate`). **Corregido en la fase 0.2**: con `AppDelegate.application(_:configurationForConnecting:options:)`, la línea `delegateClass = SceneDelegate.self` tardaba ~300 ms en tiparse y la alarma de la CI la rechazaba (ejecuciones 36168823914 y 36169354654) |
| `UIViewControllerBasedStatusBarAppearance` | `YES` (explícito) |
| `UISupportedInterfaceOrientations` | vertical + horizontal izquierda y derecha; **se quita** `~ipad` |
| `UIBackgroundModes` (`audio`), `CFBundleURLTypes` (`aceneo`), ATS, `NSCameraUsageDescription`, `NSLocalNetworkUsageDescription`, `UILaunchScreen` (`Bg`), `ITSAppUsesNonExemptEncryption` | se quedan |
| `UIApplicationShortcutItems`, `LSApplicationQueriesSchemes` | **no** (sin accesos rápidos; «Abrir en la app de AceStream» usa `UIApplication.open` y mira su resultado, sin `canOpenURL`) |

`Config/AceNeo.xcconfig`: `MARKETING_VERSION = 0.8.1`; `ACE_BUNDLE_ID = es.ismaeloul.aceplayerneo` y `ACE_DISPLAY_NAME = Ace Neo`
sin cambios.

---

## 2. Contratos Swift

### 2.0 Cómo se leen y cómo se escriben

- I0 escribe **todo lo marcado `I0→`** en la fase 0.3 con estas firmas exactas y cuerpos mínimos (valor neutro, vista
  vacía `Color.clear`); nunca `fatalError` en un camino que se ejecute al arrancar. Compila en verde con `solo_compilar`
  **antes** de abrir la fase 1.
- En este documento `{ … }` = cuerpo que escribe el módulo dueño; lo demás es el código tal cual.
- Un módulo **puede añadir** miembros a los tipos que son suyos; **no puede cambiar ni quitar** una firma de esta sección
  sin pasar por el integrador (§5.1).
- Código nuevo **sin modificadores de acceso** (todo `internal`). Los `public` del núcleo de hoy se quedan; si una firma
  `public` necesita un tipo nuevo, se le **quita** el `public` a esa declaración (nunca se añade `public` a lo nuevo).
- Todo objeto observable es `@MainActor @Observable final class`. Lo que ninguna vista debe observar lleva
  `@ObservationIgnored`. Los objetos se inyectan con `.environment(objeto)` y se leen con `@Environment(Tipo.self)`;
  los valores, con `@Entry` (§2.2.10).
- Los tipos [L] solo importan `Foundation`: nada de `SwiftUI`, `UIKit`, `CGFloat`, `os` ni `Observation`.

### 2.1 Tipos puros [L] (`Core/Reglas`)

#### 2.1.1 Navegación — `Core/Reglas/Navegacion/Destino.swift` (I0→M4)

```swift
import Foundation

enum Pestana: String, CaseIterable, Identifiable, Sendable {
    case agenda
    case canales = "biblioteca"      // en la web la ruta se llama «biblioteca»; en pantalla, «Canales»
    case buscar
    case ajustes

    var id: String { rawValue }
    var indice: Int {
        switch self {
        case .agenda: 0
        case .canales: 1
        case .buscar: 2
        case .ajustes: 3
        }
    }
    var titulo: String {
        switch self {
        case .agenda: "Agenda"
        case .canales: "Canales"
        case .buscar: "Buscar"
        case .ajustes: "Ajustes"
        }
    }
    var icono: NombreIcono {
        switch self {
        case .agenda: .agenda
        case .canales: .biblioteca
        case .buscar: .buscar
        case .ajustes: .ajustes
        }
    }
}

enum PestanaCanales: String, CaseIterable, Sendable { case favoritos, recientes, listas }

/// Chips de Ajustes (a6 §2.4). Sin «Servidor» (A-1).
enum SeccionAjustes: String, CaseIterable, Sendable {
    case listas, futbol, reproduccion, donde, apariencia, dispositivos, salud, motor, acerca
}

/// Una ruta de la web (`?vista=`, a2 §3). La pestaña y la capa del teatro salen de aquí.
enum Destino: Hashable, Sendable {
    case agenda
    case canales(PestanaCanales?)
    case buscar(q: String?)
    case ajustes(SeccionAjustes?)
    case partido(id: String)
    case canal(hash: String)
    case sistema

    /// Orden para el sentido de la transición (a2 §27.3): pestañas 0-3, teatro 10, sistema 11.
    var profundidad: Int {
        switch self {
        case .agenda: 0
        case .canales: 1
        case .buscar: 2
        case .ajustes: 3
        case .partido, .canal: 10
        case .sistema: 11
        }
    }
    var pestana: Pestana? {
        switch self {
        case .agenda: .agenda
        case .canales: .canales
        case .buscar: .buscar
        case .ajustes: .ajustes
        case .partido, .canal, .sistema: nil
        }
    }
    var esTeatro: Bool {
        switch self {
        case .partido, .canal: true
        default: false
        }
    }
    /// El valor de `?vista=` (capturas, -AceNeoEscena y pruebas).
    var vista: String {
        switch self {
        case .agenda: "agenda"
        case .canales(let p): p.map { "biblioteca/\($0.rawValue)" } ?? "biblioteca"
        case .buscar(let q): q.map { "buscar/\($0)" } ?? "buscar"
        case .ajustes(let s): s.map { "ajustes/\($0.rawValue)" } ?? "ajustes"
        case .partido(let id): "partido/\(id)"
        case .canal(let hash): "partido/canal/\(hash)"
        case .sistema: "sistema"
        }
    }
    /// Inverso de `vista`. «partido/canal/<hash>» se mira ANTES que «partido/<id>».
    init?(vista: String) { … }
}

enum Sentido: Sendable {
    case adelante, atras
    static func entre(_ desde: Destino, _ hasta: Destino) -> Sentido {
        hasta.profundidad >= desde.profundidad ? .adelante : .atras
    }
}
```

#### 2.1.2 Maquetación — `Core/Reglas/Maquetacion/Maquetacion.swift` (I0→M4)

```swift
import Foundation

struct Margenes: Hashable, Sendable {
    var arriba = 0.0, izquierda = 0.0, abajo = 0.0, derecha = 0.0
}

struct Marco: Hashable, Sendable {
    var x: Double, y: Double, ancho: Double, alto: Double
}

enum TipoPantalla: Sendable { case movil, tableta }       // ancho < 768 · ≥ 768 (a2 §2.3)

/// Todas las fórmulas del armazón (a2 §2.3, §8, §15, §16, §27.1). Puro; se prueba con seis tamaños.
struct Maquetacion: Hashable, Sendable {
    var ancho: Double                 // la ventana entera, en pt
    var alto: Double
    var seguras: Margenes

    static let referencia = Maquetacion(ancho: 390, alto: 844, seguras: Margenes(arriba: 47, abajo: 34))

    var tipo: TipoPantalla { ancho >= 768 ? .tableta : .movil }
    var horizontal: Bool { ancho > alto }
    var bajo: Bool { alto <= 540 }
    var telefonoHorizontal: Bool { horizontal && bajo }        // `phoneLandscape`
    var estrecho380: Bool { ancho <= 380 }
    var altoHeroe: Double { min(500, max(360, 0.6 * alto)) }

    /// `immersive = pantalla completa pedida || (teatro && phoneLandscape)` (a2 §2.3).
    func inmersivo(teatroVisible: Bool, forzado: Bool) -> Bool { forzado || (teatroVisible && telefonoHorizontal) }
    func barraInferior(teatroVisible: Bool, inmersivo: Bool, emparejando: Bool) -> Bool {
        tipo == .movil && !teatroVisible && !inmersivo && !emparejando
    }
    func barraSuperior(inmersivo: Bool, emparejando: Bool) -> Bool { tipo == .tableta && !inmersivo && !emparejando }

    var marcoBarraInferior: Marco {
        Marco(x: seguras.izquierda + 12, y: alto - seguras.abajo - 10 - 64,
              ancho: ancho - seguras.izquierda - seguras.derecha - 24, alto: 64)
    }
    var celdaBarra: Double { (marcoBarraInferior.ancho - 14) / 4 }
    var altoBarraSuperior: Double { 64 + seguras.arriba }

    /// Móvil: banda a 12 del borde y 82 + safeB del fondo, alto 74. Tableta: tarjeta abajo a la izquierda, ≤ 440.
    func marcoMini() -> Marco { … }
    /// Vídeo del mini: 10 dentro del marco, 96×54.
    func marcoVideoMini() -> Marco { … }
    /// Borde inferior de la pila de toasts: móvil safeB + 12 / + 94 (barra) / + 178 (barra y mini);
    /// tableta + 104 con mini si ancho ≤ 919, si no + 20.
    func bordeInferiorToasts(barra: Bool, mini: Bool) -> Double { … }
    var anchoToasts: Double { … }
    var toastsALaDerecha: Bool { tipo == .tableta }
    func altoVelo(mini: Bool) -> Double { seguras.abajo + (mini ? 180 : 100) }
    /// Teatro: safeB + 28; móvil: + 102 / + 182 (con mini); tableta: + 32 / + 120.
    func rellenoInferiorContenido(mini: Bool, teatro: Bool) -> Double { … }
    /// Móvil: safeT + 20; tableta: 64 + safeT + (agenda && bajo ? 12 : 24).
    func rellenoSuperiorCabecera(agenda: Bool) -> Double { … }
    var rellenoIzquierdo: Double { 16 + seguras.izquierda }
    var rellenoDerecho: Double { 16 + seguras.derecha }
}
```

#### 2.1.3 Avisos, señal, háptica, menús, iconos, color

```swift
// Core/Reglas/Senal/EstadoSenal.swift (I0→M2)
enum EstadoSenal: String, CaseIterable, Sendable {
    case ok, weak, fail, checking, pending
    var palabra: String {                       // ui/SignalBadge.tsx
        switch self {
        case .ok: "Verificada"
        case .weak: "Floja"
        case .fail: "Sin señal"
        case .checking: "Comprobando"
        case .pending: "Pendiente"
        }
    }
}

// Core/Reglas/Avisos/TiposAviso.swift (I0→M2) — notices/*.ts
enum TonoAviso: String, Sendable { case ok, info, warn, err }
enum ClaseAviso: Sendable { case accion, senal }            // `kind: 'action' | 'signal'`

struct Toast: Identifiable, Hashable, Sendable {
    var id: Int
    var clave: String                  // "\(tono)|\(texto)": dos iguales se agrupan (×n)
    var texto: String
    var tono: TonoAviso
    var icono: NombreIcono?
    var tituloAccion: String?          // la acción (closure) la guarda Avisos por id
    var repeticiones: Int
    var saliendo: Bool
}

struct ContenidoLinea: Hashable, Sendable {  // `StatusContent`
    var texto: String
    var tono: TonoAviso = .info
    var senal: EstadoSenal?
    var icono: NombreIcono?
    var dato: String?                  // `meta`: el dato a la derecha
}

// Core/Reglas/Avisos/ColaToasts.swift (M2) — toasts.ts: 2,8 s, máximo 2, salida 320 ms
struct ColaToasts: Sendable {
    static let duracion = 2.8, maximo = 2, salida = 0.32
    private(set) var toasts: [Toast] = []
    /// Pone o renueva (misma clave → repeticiones + 1). Devuelve el id y los que deben empezar a salir.
    mutating func poner(_ texto: String, tono: TonoAviso, icono: NombreIcono?, tituloAccion: String?)
        -> (id: Int, salen: [Int]) { … }
    mutating func empezarSalida(_ id: Int) { … }
    mutating func quitar(_ id: Int) { … }
}

// Core/Reglas/Avisos/LineaEstado.swift (M2) — statusLine.ts: 4,5 s, base del reproductor
struct LineaEstado: Sendable {
    static let duracion = 4.5
    private(set) var mensaje: (id: Int, contenido: ContenidoLinea, repeticiones: Int, saliendo: Bool)?
    private(set) var base: ContenidoLinea?
    mutating func mostrar(_ contenido: ContenidoLinea) -> Int { … }
    mutating func fijarBase(_ base: ContenidoLinea?) { … }
    mutating func empezarSalida() { … }
    mutating func vaciar() { … }
    /// notify(): `signal` sin acción y viendo el teatro → línea; lo demás → toast.
    static func destino(clase: ClaseAviso, conAccion: Bool, viendoTeatro: Bool) -> DestinoAviso {
        clase == .senal && !conAccion && viendoTeatro ? .linea : .toast
    }
}
enum DestinoAviso: Sendable { case linea, toast }

// Core/Reglas/Haptica/TipoHaptico.swift (I0→M2) — lib/haptics.ts
enum TipoHaptico: String, CaseIterable, Sendable {
    case seleccion, ligera, media, fuerte, rigida, exito, aviso, error
}
enum ReglaHaptica {
    static let rafagaMs = 40.0
    /// «selección» calla con movimiento reducido; la misma sensación no se repite en < 40 ms.
    static func suena(_ tipo: TipoHaptico, ahoraMs: Double, ultimo: (tipo: TipoHaptico, ms: Double)?,
                      reducirMovimiento: Bool) -> Bool {
        if tipo == .seleccion && reducirMovimiento { return false }
        if let ultimo, ultimo.tipo == tipo, ahoraMs - ultimo.ms < rafagaMs { return false }
        return true
    }
}

// Core/Reglas/Menus/OpcionMenu.swift (I0)
struct OpcionMenu: Identifiable, Hashable, Sendable {
    var id: String
    var titulo: String
    var icono: NombreIcono?
    var peligro = false
    var marcada = false                 // se pinta como Toggle
    var deshabilitada = false
    var separadaAntes = false           // abre una Section nueva
    var haptica: TipoHaptico?           // la de la ACCIÓN (abrir el menú no suena)
}

// Core/Reglas/Iconos/NombreIcono.generado.swift [G] (I0→P) — los 52 de ui/icons.ts, en su orden
enum NombreIcono: String, CaseIterable, Sendable {
    case agenda, biblioteca, buscar, ajustes, play, pause, stop, vol, mute, back, full, pip, more, star
    case starF = "star-f"
    case copy, paste, flag, refresh, check, learn
    case chevD = "chev-d", chevU = "chev-u", chevL = "chev-l", chevR = "chev-r"
    case tv, motor, nerd, hash, link, plus, list, clock, eye
    case eyeOff = "eye-off"
    case panel, x, pencil, trash, kbd, sol, luna, pantalla, movil, qr, externo, info, aviso, ayuda, senal, directo, subir
}

// Core/Reglas/Color/ColorOKLab.swift (M2)
struct RGB: Hashable, Sendable { var r: Double, g: Double, b: Double }     // sRGB 0…1
```

#### 2.1.4 Datos puros (`Core/Reglas/Datos`, I0→M1)

```swift
import Foundation

protocol Reloj: Sendable { var ahora: Date { get } }
struct RelojSistema: Reloj { var ahora: Date { Date() } }
/// Reloj que empieza en `inicio` y avanza con el de verdad (-AceNeoReloj, demo y capturas).
struct RelojDesplazado: Reloj {
    let inicio: Date
    let arranque: Date
    init(inicio: Date, arranque: Date = Date()) { self.inicio = inicio; self.arranque = arranque }
    var ahora: Date { inicio.addingTimeInterval(Date().timeIntervalSince(arranque)) }
}

enum IdentidadDispositivo {
    /// `<deviceId>.<secreto>` → `deviceId` (a7 §7).
    static func id(token: String) -> String? { token.split(separator: ".", maxSplits: 1).first.map(String.init) }
}

enum EsperaSSE {
    /// 3, 6, 12, 24, 48, 60, 60… s (a7 §6.2).
    static func espera(intento: Int) -> Double { min(60, 3 * pow(2, Double(min(max(intento, 1) - 1, 5)))) }
}

/// Rutas de administración abiertas a la app en la 0.8.1 (a9 §2).
enum RutaAdministracion: String, CaseIterable, Sendable {
    case health, settingsUpdate, pairingCreate, devicesList, deviceRevoke
}
/// Memoria de proceso de lo que un servidor viejo (0.8.0) cerró con 403 `origin_forbidden`.
struct Capacidades: Sendable {
    private(set) var cerradas: Set<RutaAdministracion> = []
    /// Solo cuenta el 403 con código `origin_forbidden`; cualquier otro error no cierra nada.
    mutating func registrar(_ codigo: String, en ruta: RutaAdministracion) { if codigo == "origin_forbidden" { cerradas.insert(ruta) } }
    mutating func olvidar() { cerradas = [] }
    var servidorViejo: Bool { !cerradas.isEmpty }
}

/// Una consulta de caché (una por ruta de lectura). Lo que invalida cada evento se expresa con esto.
enum RutaConsulta: String, CaseIterable, Sendable {
    case bootstrap, libraryGet, preferencesGet, directoriesGet, settingsGet, playbackStatus, engineStatus
    case footballSchedule, scores, footballPreheat, footballResolve, footballScan, health, diagnosticsList
    case devicesList, search
}

/// Lo que un evento SSE provoca (a7 §6.3-6.4). `RepartidorEventos` lo aplica; aquí solo se decide.
enum EfectoEvento: Hashable, Sendable {
    case invalidar(Set<RutaConsulta>)
    case invalidarTodo                                        // resync
    case escribirMotor(EngineStatus)
    case escribirSonando(NowPlaying?, aprendidos: Int)
    case escribirSesiones([SessionSummary])
    case trabajo(jobId: String)                               // invalida ese footballScan
    case senalPartido(ScanProgressData)                       // almacén por matchId
    case veredicto(ScanVerdictData)                           // sesión de fuentes
    case dispositivos(DevicesChangedData)                     // emparejar / revocado desde otro
    case alReproductor(SSEEvent)                              // dirigidos, filtrados por viewerIds
    case versionPosible                                       // tras resync: VigiaVersion hace ping
}
enum EfectosEvento {
    static func de(_ evento: SSEEvent) -> [EfectoEvento] { … }
    /// `SCOPE_ROUTES` (a7 §6.4).
    static func rutas(de ambito: StateScope) -> Set<RutaConsulta> { … }
}
```

Los modelos (`EngineStatus`, `NowPlaying`, `SessionSummary`, `ScanProgressData`, `ScanVerdictData`, `DevicesChangedData`,
`SSEEvent`, `StateScope`) ya existen en `Core/Models` y son [L]. Si alguno no es `Hashable`, M1 le añade la conformidad
(todos lo son hoy).

#### 2.1.5 Gestos — `Core/Reglas/Gestos/Deslizamiento.swift` (M2; números de la web)

```swift
enum ResultadoDeslizar: Sendable { case ninguno, izquierda, derecha, arriba, abajo }

enum Deslizamiento {
    /// classifySwipe: distancia ≥ 56 pt o velocidad ≥ 450 pt/s con ≥ 24 pt, y eje dominante ≥ 1,4×.
    static func clasificar(dx: Double, dy: Double, vx: Double, vy: Double) -> ResultadoDeslizar { … }
}
enum Volver {
    /// Soltar el borde izquierdo: vuelve si dx ≥ 0,35·ancho o (vx ≥ 450 y dx ≥ 24).
    static func decide(dx: Double, vx: Double, ancho: Double) -> Bool { dx >= 0.35 * ancho || (vx >= 450 && dx >= 24) }
}
enum GestosMini {
    static let umbral = 72.0            // arrastre que decide
    static let descartarFraccion = 0.25 // del ancho
    static let salidaMs = 320.0
    enum Soltar: Sendable { case volver, abrir, descartar }
    static func soltar(dx: Double, dy: Double, vx: Double, vy: Double, ancho: Double) -> Soltar { … }
}
```

### 2.2 Palco (`Sources/Palco`, P)

> **Calibrado en la fase 0.4 (P, `c0-laboratorio.md`) y fijado al cerrar la fase 0.** Lo que cambió respecto al
> primer borrador y ya está abajo: `.tarjeta()` con **`R.xl`** por defecto (Surface.tsx); `MarcaEquipo.Patron` con
> **`.mitades`**; **`altoLinea: 1.45`** en los estilos que en la web heredan el `line-height` del `body` (segmento,
> menú, línea de estado, etiqueta de campo, pista, error, rótulo de la barra, destino de la barra superior, «Modo
> demo» y motor); **Martian** con su caja natural de 1,2 em (`Martian.altoNatural`, `.altoDeLineaMartian`, que
> `.estilo()` usa en los estilos `mono`); los valores de entorno **`llenarAncho`** y **`trackingCapsulaEm`**;
> **`contador`** en `OpcionSegmento`; `FilaEquiposPartido(…, encendido:)`; `R.interiorTarjeta`, `Alturas` y
> `panelCristal`. El cristal de vídeo pinta siempre en oscuro (`EsquemaCristal`, como `.glass--video`).

#### 2.2.1 Color

```swift
import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32, alfa: Double = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: CGFloat(alfa))
    }
}

extension Color {
    /// sRGB exacto de tokens.css; cambia con el tema de la ventana.
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1) {
        self.init(uiColor: UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark ? UIColor(hex: oscuro, alfa: alfaOscuro) : UIColor(hex: claro, alfa: alfaClaro)
        })
    }
    init(hex: UInt32, alfa: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: alfa)
    }
}

extension RGB {
    var color: Color { Color(.sRGB, red: r, green: g, blue: b) }
}

// Tokens/ColoresPalco.generado.swift [G] — GENERADO por scripts/generar-tokens.mjs. No editar.
enum Palco {
    static let surface = Color(claro: 0xFFFFFF, oscuro: 0x0F1218)
    static let surface2 = Color(claro: 0xECECEE, oscuro: 0x171B23)
    static let text = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF)
    static let glassSolid = Color(claro: 0xFAFAFB, oscuro: 0x12161D)
    // … y el resto de a1 §2.1-2.2, con estos nombres exactos:
    // bg bgSunk surface surface2 line lineSoft lineStrong text text2 text3 accent onAccent accentInk accentEdge
    // accentWash live liveInk ok okInk weak weakInk fail failInk glass glassDense glassSolid glassHi glassRim scrim
    // sombra glassVideo glassVideoSolid onVideo onVideo2 veil veilStrong
}
/// Mezclas resueltas que no son `.opacity(p)` de un token (a1 §2.3-2.4, a3 §1.3, a6 §0.1). También generado.
enum PalcoMezcla { static let liveCapsula = Color(claro: 0xB1231A, oscuro: 0xD12E25) /* … */ }
```

Regla: una mezcla `color-mix(token p %, transparent)` se escribe `Palco.token.opacity(p)`; solo las mezclas entre dos
colores van a `PalcoMezcla`. Nadie escribe un hex fuera de estos dos ficheros (lo mira el linter).

#### 2.2.2 Medidas y movimiento

```swift
enum S {            // espacio, base 4 (a1 §4.1)
    static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20
    static let s6: CGFloat = 24, s8: CGFloat = 32, s10: CGFloat = 40, s12: CGFloat = 48
    static let gutter: CGFloat = 16, tap: CGFloat = 44
}
enum R {            // radios (a1 §4.2)
    static let xl: CGFloat = 24, l: CGFloat = 18, m: CGFloat = 14, s: CGFloat = 10, xs: CGFloat = 6
    /// Radio de algo metido en un contenedor de radio `exterior` con `relleno`.
    static func interior(_ exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(0, exterior - relleno) }
    /// `--r-inner` de Card y Panel: `max(6, exterior − relleno)` (Surface.css).
    static func interiorTarjeta(_ exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(6, exterior - relleno) }
}
enum Alturas {      // tokens.css: barra 64, hueco 10, barra superior 64, mini 72, control 44, botón sm 36, campo 52, toast 52
    static let barra: CGFloat = 64, huecoBarra: CGFloat = 10, barraSuperior: CGFloat = 64, mini: CGFloat = 72
    static let control: CGFloat = 44, botonSm: CGFloat = 36, campo: CGFloat = 52, toast: CGFloat = 52
}
enum Capa {         // zIndex del armazón (a2 §4); hojas y menús son del sistema
    static let pestanas = 0.0, partido = 20.0, velo = 39.0, barra = 40.0, mini = 41.0, vuelo = 45.0
    static let avisos = 60.0, inmersivo = 100.0
}
enum Movimiento {   // a1 §7
    static func rapido(_ reducido: Bool) -> Animation { reducido ? .easeOut(duration: 0.12) : .spring(duration: 0.25, bounce: 0) }
    static func estandar(_ reducido: Bool) -> Animation { reducido ? .easeOut(duration: 0.15) : .spring(duration: 0.4, bounce: 0.15) }
    static var heroe: Animation { .spring(duration: 0.55, bounce: 0.3) }
    static var progreso: Animation { .spring(duration: 0.615, bounce: 0.15) }
    static var salida: Animation { .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32) }
    static func vista(_ reducido: Bool) -> Animation { .easeOut(duration: reducido ? 0.12 : 0.34) }
    static func soltar(velocidad: Double) -> Animation { .interpolatingSpring(duration: 0.4, bounce: 0.15, initialVelocity: velocidad) }
    static func escalonado(_ i: Int) -> Double { Double(min(i, 10)) * 0.036 }
}
```

#### 2.2.3 Tipografía

```swift
import CoreText
import SwiftUI
import UIKit
import os

enum VarianteMona: Sendable { case palco, campos }   // MonaSansPalco (Text) · MonaSans original (TextField)

enum Mona {
    private struct Clave: Hashable, Sendable { var tamano: Double, peso: Double, anchura: Double }
    private static let fuentes = OSAllocatedUnfairLock<[Clave: Font]>(initialState: [:])
    private static let wdth = 0x7764_7468, wght = 0x7767_6874

    /// Siempre los dos ejes (si falta uno, CoreText usa el defecto: wght 200).
    static func fuente(_ tamano: Double, peso: Double, anchura: Double = 100) -> Font {
        let clave = Clave(tamano: tamano, peso: peso, anchura: anchura)
        if let hecha = fuentes.withLock({ $0[clave] }) { return hecha }
        let nueva = Font(ctFont(tamano, peso: peso, anchura: anchura, variante: .palco))
        fuentes.withLock { $0[clave] = nueva }
        return nueva
    }
    static func ctFont(_ tamano: Double, peso: Double, anchura: Double = 100, variante: VarianteMona = .palco) -> CTFont {
        let atributos: [CFString: Any] = [
            kCTFontNameAttribute: variante == .palco ? "PalcoSans-ExtraLight" : "MonaSans-ExtraLight",
            kCTFontVariationAttribute: [NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso)],
        ]
        return CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(atributos as CFDictionary), CGFloat(tamano), nil)
    }
    static func uiFont(_ tamano: Double, peso: Double, anchura: Double = 100, variante: VarianteMona = .campos) -> UIFont {
        let ejes: [NSNumber: NSNumber] = [NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso)]
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: variante == .palco ? "PalcoSans-ExtraLight" : "MonaSans-ExtraLight",
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): ejes,
        ])
        return UIFont(descriptor: descriptor, size: CGFloat(tamano))
    }
}
enum Martian {      // wdth 87,5; peso 400 (560 en teclas); P fija el nombre PostScript en ORIGEN.json
    static func fuente(_ tamano: Double, peso: Double = 400) -> Font { … }
    /// Caja natural de una línea (1000/−200 = 1,2 em, llevada a la rejilla @3x): Martian NO se normalizó a 1 em.
    static func altoNatural(_ tamano: Double) -> Double { … }
}

struct EstiloTexto: Hashable, Sendable {
    var tamano: Double
    var peso: Double
    var anchura: Double = 100
    var trackingEm: Double = 0
    var altoLinea: Double? = nil       // múltiplo del tamaño (1,45 = 145 %); nil = el natural de MonaSansPalco
    var mayusculas = false
    var mono = false

    // a1 §3.4, tal cual
    static let cuerpo = EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.45)
    static let titularVista = EstiloTexto(tamano: 30, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)
    static let titularVistaAncha = EstiloTexto(tamano: 44, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)
    static let subtituloVista = EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)
    static let tituloHoja = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25)
    static let tituloVacio = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.25)
    static let tituloSeccion = EstiloTexto(tamano: 17, peso: 720, anchura: 125, altoLinea: 1.45)
    static let kicker = EstiloTexto(tamano: 13, peso: 700, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true)
    static let boton = EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.1)
    static let botonSm = EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.1)
    static let chip = EstiloTexto(tamano: 12, peso: 650, anchura: 88, altoLinea: 1.45)
    static let capsula = EstiloTexto(tamano: 13, peso: 640, anchura: 88, altoLinea: 1)
    static let capsulaSm = EstiloTexto(tamano: 11, peso: 640, anchura: 88, trackingEm: 0.02, altoLinea: 1)
    static let senal = EstiloTexto(tamano: 12, peso: 620, anchura: 88, altoLinea: 1.15)
    static let senalLg = EstiloTexto(tamano: 13, peso: 620, anchura: 88, altoLinea: 1.15)
    static let anillo = EstiloTexto(tamano: 12, peso: 640, anchura: 88, altoLinea: 1.15)
    static let segmento = EstiloTexto(tamano: 13, peso: 620, altoLinea: 1.45)
    static let menu = EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.45)
    static let toast = EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.25)
    static let lineaEstado = EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.45)
    static let etiquetaCampo = EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.45)
    static let campo = EstiloTexto(tamano: 16, peso: 450)
    static let pista = EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)
    static let errorCampo = EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)
    static let pestanaBarra = EstiloTexto(tamano: 11, peso: 620, anchura: 88, altoLinea: 1.45)
    static let destinoBarraSuperior = EstiloTexto(tamano: 13, peso: 620, anchura: 88, altoLinea: 1.45)
    static let modoDemo = EstiloTexto(tamano: 11, peso: 650, anchura: 88, altoLinea: 1.45)
    static let motor = EstiloTexto(tamano: 12, peso: 600, anchura: 88, altoLinea: 1.45)
    static let mono = EstiloTexto(tamano: 12, peso: 400, anchura: 87.5, mono: true)
    static func cifras(_ tamano: Double) -> EstiloTexto { EstiloTexto(tamano: tamano, peso: 780, anchura: 75) }
}

extension View {
    /// Fuente + tracking + mayúsculas + alto de línea de la web. La única forma de dar estilo a un Text.
    func estilo(_ e: EstiloTexto) -> some View { … }
    /// line-height CSS: lineSpacing((lh − 1)·t) + padding vertical (lh − 1)·t / 2 (primera y última línea).
    func altoDeLinea(_ lh: Double, tamano: Double) -> some View {
        lineSpacing((lh - 1) * tamano).padding(.vertical, (lh - 1) * tamano / 2)
    }
    /// Lo mismo para Martian: el sobrante `lh·t − Martian.altoNatural(t)` (su caja es 1,2 em, no 1 em).
    func altoDeLineaMartian(_ lh: Double, tamano: Double) -> some View { … }
}
```

Plan B del alto de línea (si la fase 0 no casa con la web a ±1 pt): `TextoMultilinea` (`UIViewRepresentable` con
`UILabel` y `NSParagraphStyle.minimumLineHeight = maximumLineHeight = lh·t`) solo para los textos de más de una línea.

#### 2.2.4 Iconos

```swift
enum ParteIcono: Sendable { case trazo, relleno }

/// Un icono de ui/icons.ts en la rejilla 24, escalado al rectángulo. Trazo 1,8/24 del lado, puntas y uniones redondas.
struct FormaIcono: Shape {
    let nombre: NombreIcono
    var parte: ParteIcono = .trazo
    func path(in rect: CGRect) -> Path { TrazosIcono.camino(nombre, parte: parte, en: rect) }   // generado
}

struct IconoPalco: View {
    init(_ nombre: NombreIcono, tamano: CGFloat = 20, relleno: Bool = false) { … }
    var body: some View { … }    // FormaIcono(.relleno).fill + FormaIcono(.trazo).stroke(lineWidth: 1.8·t/24, lineCap: .round, lineJoin: .round)
}

@MainActor enum IconoImagen {
    /// UIImage plantilla (para Menu, contextMenu y Label del sistema). Caché por nombre y tamaño.
    static func imagen(_ nombre: NombreIcono, tamano: CGFloat = 20) -> UIImage { … }
}
```

#### 2.2.5 Cristal

```swift
enum TipoCristal: Sendable { case denso, regular, video, videoBoton }

enum CristalPalco {
    /// Interruptor de rendimiento: false = sólido en las filas de listas largas.
    static let vidrioEnListas = true
    /// ÚNICO sitio del tinte (I2 lo calibra contra las capturas). Cierre de la fase 0 (c0-cristal/): en claro
    /// NO se tiñe (ningún tinte quitaba el reflejo de la imagen) y lo pone velo(_:); en oscuro, el token.
    static func vidrio(_ tipo: TipoCristal) -> Glass {
        switch tipo {
        case .denso: .regular.tint(soloEnOscuro(Palco.glassDense))
        case .regular: .regular.tint(soloEnOscuro(Palco.glass))
        case .video: .regular.tint(Palco.glassVideo)
        case .videoBoton: .regular.tint(Palco.glassVideo).interactive()
        }
    }
    /// .glass { background: var(--glass) } de la web sobre el vidrio, solo en claro (video: Color.clear).
    static func velo(_ tipo: TipoCristal) -> Color { … }
    static func solido(_ tipo: TipoCristal) -> Color {
        switch tipo {
        case .denso, .regular: Palco.glassSolid
        case .video, .videoBoton: Palco.glassVideoSolid
        }
    }
}

extension View {
    /// El ÚNICO `.glassEffect(` de la app. Con transparencia reducida (sistema o app) pinta el sólido exacto de la web.
    func cristal(_ tipo: TipoCristal, en forma: some Shape = Capsule()) -> some View {
        modifier(ModificadorCristal(tipo: tipo, forma: forma))
    }
}

private struct ModificadorCristal<Forma: Shape>: ViewModifier {
    let tipo: TipoCristal
    let forma: Forma
    @Environment(\.cristalOpaco) private var opaco
    func body(content: Content) -> some View {
        if opaco {
            content.background(CristalPalco.solido(tipo), in: forma)
        } else {
            content.background(CristalPalco.velo(tipo), in: forma)   // --glass encima del vidrio, solo en claro
                .glassEffect(CristalPalco.vidrio(tipo), in: forma)
        }
    }
}
```

Las cápsulas de directo y oro **no** son cristal: llevan su color siempre (`Palco.live`, `Palco.accent`). Varias piezas de
cristal juntas (barra, fila de botones del vídeo) van dentro de un `GlassEffectContainer`.

#### 2.2.6 Sombras

```swift
enum SombraPalco: Sendable { case s1, s2, s3, video, barra, mini }      // a1 §5, valores exactos en el cuerpo
extension View {
    func sombra(_ s: SombraPalco, forma: some Shape = RoundedRectangle(cornerRadius: R.l)) -> some View { … }
    func bordeInterior(_ color: Color, ancho: CGFloat = 1, forma: some Shape) -> some View { … }   // strokeBorder
    func brilloSuperior(forma: some Shape) -> some View { … }                                     // --glass-hi 1 pt arriba
}
```

#### 2.2.7 Háptica

```swift
struct PulsoHaptico: Equatable, Sendable {
    var n: Int
    var tipo: TipoHaptico
}

@MainActor @Observable final class Haptica {
    private(set) var pulso = PulsoHaptico(n: 0, tipo: .seleccion)
    var reducirMovimiento = false
    @ObservationIgnored private var ultimo: (tipo: TipoHaptico, ms: Double)?
    private let origen = ContinuousClock.now

    /// La ÚNICA forma de hacer vibrar el iPhone.
    func disparar(_ tipo: TipoHaptico) {
        let t = ContinuousClock.now - origen
        let ms = Double(t.components.seconds) * 1000 + Double(t.components.attoseconds) / 1e15
        guard ReglaHaptica.suena(tipo, ahoraMs: ms, ultimo: ultimo, reducirMovimiento: reducirMovimiento) else { return }
        ultimo = (tipo, ms)
        pulso = PulsoHaptico(n: pulso.n &+ 1, tipo: tipo)
    }
}

extension TipoHaptico {
    var feedback: SensoryFeedback {
        switch self {
        case .seleccion: .selection
        case .ligera: .impact(weight: .light)
        case .media: .impact(weight: .medium)
        case .fuerte: .impact(weight: .heavy)
        case .rigida: .impact(flexibility: .rigid)
        case .exito: .success
        case .aviso: .warning
        case .error: .error
        }
    }
}

/// El ÚNICO `.sensoryFeedback(` de la app (en RaizView).
struct HapticaRaiz: ViewModifier {
    let haptica: Haptica
    func body(content: Content) -> some View {
        content.sensoryFeedback(trigger: haptica.pulso) { _, nuevo in nuevo.tipo.feedback }
    }
}
```

#### 2.2.8 Gestos compartidos

```swift
/// Pan horizontal con bloqueo de eje (8 pt) que convive con un ScrollView vertical, cede a los carriles
/// horizontales y al gesto del borde. Lo usan el panel de partidos (cambiar de día), la barra «emitiendo» y el vídeo.
struct DeslizamientoHorizontal: UIGestureRecognizerRepresentable {
    var activo = true
    var cedeACarriles = true
    var cedeAlBorde = true
    var alMover: (_ dx: CGFloat) -> Void
    var alSoltar: (_ dx: CGFloat, _ dy: CGFloat, _ vx: CGFloat) -> Void
    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer { … }
    func handleUIGestureRecognizerAction(_ reconocedor: UIPanGestureRecognizer, context: Context) { … }
}

extension View {
    /// Tocar la barra de estado sube esta vista (scrollsToTop solo en la pestaña visible, a2 §27.5).
    func subeConLaBarraDeEstado(_ activo: Bool) -> some View { … }
}
```

#### 2.2.9 Galería y laboratorio

- `SistemaView()` — la galería «Sistema» de la web (a1 §11), con los mismos bloques; se abre con 7 toques en «Versión»
  (Acerca de) o con `-AceNeoSistema` en Debug.
- `LaboratorioView()` (`#if DEBUG`, `-AceNeoLaboratorio`) — banco de la fase 0 (§4.1.4). Se queda en Debug para siempre:
  es el sitio donde I2 calibra tinte, alto de línea y sombras.
- Las dos viven **dentro de `RaizView`** (§2.3), con el entorno de la app: háptica central, hojas por `CentroHojas`
  (`Hoja.muestra(HojaMuestra)`, §2.4.2), menú por `menuContextual`, tema y transparencia de `PreferenciasLocales`
  (como `setTheme`/`setTransparency` de SistemaPage.tsx) y ventana por `EstadoVentana`. Sin UIKit propio ni estado
  global (`ModoGaleria`, `VentanaPalco` y `PresentadorHoja` ya no existen). Bloques del banco: 1 fuentes, 2 iconos,
  3 cristal, 4 hojas y menús, 5 barra de estado («Barra clara» e «Inmersivo» publican en `EstadoVentana`), 6 háptica
  (con la cuenta de pulsos de la raíz), 7 gestos y cifras, 8 marcos del vuelo (`.piezaVuelo`), 9 calibración del tinte.

#### 2.2.10 Valores de entorno — `Palco/Entorno/ValoresEntorno.swift` (I0→P)

```swift
extension EnvironmentValues {
    @Entry var maquetacion: Maquetacion = .referencia
    /// false en las pestañas ocultas: sondeos, relojes y animaciones continuas parados.
    @Entry var vistaActiva: Bool = true
    @Entry var modoDemo: Bool = false
    /// Transparencia reducida del sistema O de la app (Ajustes › Apariencia).
    @Entry var cristalOpaco: Bool = false
    /// Movimiento reducido del sistema O -AceNeoMovimientoReducido (capturas).
    @Entry var movimientoReducido: Bool = false
    @Entry var radioInterior: CGFloat = 8
    @Entry var cacheImagenes: CacheImagenes? = nil
}

// Con su primitiva (P, fase 0.4):
extension EnvironmentValues {
    @Entry var trackingCapsulaEm: Double? = nil      // Capsula.swift: el «cuándo» del versus (+0,06 em)
    @Entry var llenarAncho: Bool = false             // Capsula y PastillaCompeticion a todo el ancho de su celda
    @Entry var estadoMotor: EstadoMotorVista? = nil  // CabeceraVista.swift: nil = sin indicador del motor
    @Entry var abrirSaludMotor: AccionPalco? = nil   // qué hace tocar el indicador (Ajustes › Salud)
}
```

#### 2.2.11 Primitivas (una por fichero en `Palco/Componentes`; a1 §10)

```swift
struct EstiloPulsar: ButtonStyle { … }          // .press: escala 0,97 y opacidad, a1 §7.4

struct BotonPalco: View {
    enum Variante: Sendable { case primario, quieto, fantasma, cristal, video, peligro }
    enum Tamano: Sendable { case md, sm }
    init(_ titulo: String, icono: NombreIcono? = nil, iconoFinal: NombreIcono? = nil, variante: Variante = .primario,
         tamano: Tamano = .md, bloque: Bool = false, pulsado: Bool? = nil, ocupado: Bool = false,
         accion: @escaping () -> Void) { … }
}
struct BotonIcono: View {
    init(_ icono: NombreIcono, etiqueta: String, variante: BotonPalco.Variante = .fantasma, grande: Bool = false,
         pulsado: Bool? = nil, iconoPulsado: NombreIcono? = nil, relleno: Bool = false, ocupado: Bool = false,
         accion: @escaping () -> Void) { … }
}
enum TonoPanel: Sendable { case normal, hundido, acento }
extension View {
    func tarjeta(radio: CGFloat = R.xl, relleno: CGFloat = S.s4) -> some View { … }   // Surface.tsx:49-50
    func panelCristal(_ tipo: TipoCristal = .regular, radio: CGFloat = R.l, relleno: CGFloat = S.s3) -> some View { … }
    func panel(_ tono: TonoPanel = .normal, radio: CGFloat = R.m, relleno: CGFloat = S.s3) -> some View { … }
    func islaOscura() -> some View { environment(\.colorScheme, .dark) }     // contenido sobre vídeo o héroe
}
struct Chip: View {
    enum Tono: Sendable { case suave, mio, directo }
    enum Contorno: Sendable { case solido, discontinuo }
    init(_ titulo: String, icono: NombreIcono? = nil, contador: Int? = nil, tono: Tono = .suave,
         contorno: Contorno? = nil, pulsado: Bool = false, accion: (() -> Void)? = nil) { … }
}
struct Capsula: View {
    enum Tono: Sendable { case neutral, directo, ok, weak, fail, oro }
    enum Tamano: Sendable { case md, sm }
    init(_ texto: String, tono: Tono = .neutral, tamano: Tamano = .md, punto: Bool = false, icono: NombreIcono? = nil,
         cristal: TipoCristal? = nil, pulsado: Bool? = nil, accion: (() -> Void)? = nil) { … }
}
struct MedidorSenal: View {
    enum Tamano: Sendable { case sm, md, lg }
    init(_ estado: EstadoSenal, tamano: Tamano = .md, palabra: String? = nil, ocultarPalabra: Bool = false,
         apilado: Bool = false, compacto: Bool = false) { … }
}
enum EstadoAnillo: Hashable, Sendable { case senal(EstadoSenal), reportada, activa }
struct AnilloSenal: View { init(_ estado: EstadoAnillo, tamano: CGFloat = 28, palabra: String? = nil) { … } }
struct PuntoDirecto: View { init(etiqueta: String? = nil) { … } }
struct Onda: View { init(color: Color, escalaMaxima: CGFloat, diametro: CGFloat) { … } }   // halo de «en directo»

struct Num: View {
    enum Animacion: Sendable { case ninguna, paleta, rueda }   // paleta al destapar; rueda (.numericText) al cambiar
    /// Cada cifra en una celda fija (0,49 em condensada, 0,645 em normal, 0,72 em código de emparejar); nunca .monospacedDigit().
    init(_ texto: String, tamano: CGFloat, condensado: Bool = true, celda: Double? = nil, etiqueta: String? = nil,
         animacion: Animacion = .ninguna) { … }
}
struct BarraProgreso: View {
    enum Tono: Sendable { case normal, directo, oro }
    init(valor: Double, fina: Bool = false, tono: Tono = .normal, muescas: [Double] = [], etiqueta: String) { … }
}

struct DatosEquipo: Hashable, Sendable {
    var nombre: String
    var siglas: String
    var primario: RGB
    var secundario: RGB?
    var escudo: URL?
    var halo: RGB?
}
struct MarcaEquipo: View {
    enum Patron: Sendable { case liso, franjas, mitades }   // team--rayas, team--mitades
    init(_ equipo: DatosEquipo, tamano: CGFloat, encendido: Bool = true, patron: Patron = .liso) { … }
}
struct MarcaCanal: View {
    enum Forma: Sendable { case redonda, tesela }
    init(nombre: String, forma: Forma = .redonda, tamano: CGFloat = 40) { … }
}
struct PastillaCompeticion: View { init(nombre: String, logo: URL?, tamano: CGFloat = 20) { … } }

struct DatosVersus: Hashable, Sendable {
    var local: DatosEquipo
    var visitante: DatosEquipo
    var mitadLocal: RGB
    var mitadVisitante: RGB
    var competicion: String
    var logoCompeticion: URL?
    var cuando: String
    var enDirecto: Bool
    var terminado: Bool
    var tuEquipo: Bool
    var enPantalla: Bool
}
struct TarjetaVersus<Senal: View>: View {
    enum Tamano: Sendable { case sm, md, lg, xl }
    init(_ datos: DatosVersus, tamano: Tamano = .md, seleccionada: Bool = false, @ViewBuilder senal: () -> Senal) { … }
}
struct BloqueEscudos: View { init(_ datos: DatosVersus, tamano: CGFloat) { … } }            // pieza que vuela
struct FilaEquiposPartido: View {                                                             // destino del vuelo
    init(local: DatosEquipo, visitante: DatosEquipo) { … }
    init(local: DatosEquipo, visitante: DatosEquipo, encendido: Bool) { … }                      // en directo
}

struct CarrilCarteles<Datos: RandomAccessCollection, Celda: View>: View where Datos.Element: Identifiable {
    init(_ datos: Datos, anchoCelda: CGFloat, sangrado: CGFloat = 16, etiqueta: String,
         @ViewBuilder celda: @escaping (Datos.Element) -> Celda) { … }
}

struct OpcionSegmento<Valor: Hashable>: Identifiable {
    var valor: Valor
    var titulo: String
    var icono: NombreIcono?
    var id: Valor { valor }
    var contador: Int? = nil       // «Para ti 8»: Num 13 en --text-3
}
struct Segmentado<Valor: Hashable>: View {
    init(_ opciones: [OpcionSegmento<Valor>], seleccion: Binding<Valor>, bloque: Bool = false, etiqueta: String,
         pestanas: Bool = false, alCambiar: ((Valor) -> Void)? = nil) { … }
}
struct EstiloInterruptor: ToggleStyle { … }
struct FilaInterruptor: View {
    init(_ titulo: String, descripcion: String? = nil, activo: Binding<Bool>, deshabilitado: Bool = false) { … }
}
enum PielCampo: Sendable { case normal, buscador }
struct CampoTexto<Derecha: View>: View {
    init(_ etiqueta: String, texto: Binding<String>, marcador: String = "", icono: NombreIcono? = nil,
         piel: PielCampo = .normal, pista: String? = nil, error: String? = nil, ocultarEtiqueta: Bool = false,
         enfocado: FocusState<Bool>.Binding? = nil, @ViewBuilder derecha: () -> Derecha) { … }
}
struct EstadoVacio<Acciones: View>: View {
    init(titulo: String, texto: String? = nil, error: Bool = false, @ViewBuilder acciones: () -> Acciones) { … }
}
struct Esqueleto: View { init(ancho: CGFloat? = nil, alto: CGFloat, radio: CGFloat = R.xs) { … } }
struct FilasEsqueleto: View { init(_ filas: Int, anuncio: String) { … } }
enum EstadoMotorVista: Sendable { case enLinea, arrancando, apagado, comprobando, sinRespuesta }
struct IndicadorMotor: View { init(_ estado: EstadoMotorVista, soloIcono: Bool = false, accion: @escaping () -> Void) { … } }
struct CabeceraVista<Acciones: View>: View {
    init(_ titulo: String, subtitulo: String? = nil, sobreOscuro: Bool = false, ocultarMotor: Bool = false,
         @ViewBuilder acciones: () -> Acciones) { … }
}
struct Flujo: Layout {                                // filas que saltan (chips, pastillas)
    init(horizontal: CGFloat = 8, vertical: CGFloat = 8, alineacion: HorizontalAlignment = .leading) { … }
}
enum TamanoHoja: Sendable { case sm, md, lg }        // anchos de la web en ≥ 768: 420 / 560 / 760
struct ContenidoHoja<Cuerpo: View, Pie: View>: View {
    init(titulo: String, descripcion: String? = nil, tamano: TamanoHoja = .md, cerrable: Bool = true,
         ocultarTitulo: Bool = false, alCerrar: @escaping () -> Void,
         @ViewBuilder cuerpo: () -> Cuerpo, @ViewBuilder pie: () -> Pie) { … }
}
struct ToastVista: View { init(_ toast: Toast, alAccion: @escaping () -> Void, alCerrar: @escaping () -> Void) { … } }
struct LineaEstadoVista: View {
    enum Variante: Sendable { case tarjeta, sobreVideo }
    init(_ contenido: ContenidoLinea, repeticiones: Int = 1, variante: Variante = .tarjeta) { … }
}
struct Tecla: View { init(_ texto: String) { … } }
/// «Toca otra vez para confirmar» (3 s): el segundo toque ejecuta.
@MainActor @Observable final class SegundoToque {
    private(set) var armado: String?
    func tocar(_ id: String, plazo: Duration = .seconds(3), ejecutar: @escaping () -> Void) { … }
    func desarmar() { … }
}
struct ImagenServidor: View {        // escudos y logos: CacheImagenes del entorno, byPreparingForDisplay
    init(_ url: URL?, tamano: CGSize, @ViewBuilder respaldo: () -> some View) { … }
}
```

`ImagenServidor` guarda el respaldo como `AnyView` (el único `AnyView` permitido; lo mira el linter) para no hacer genérico
un tipo que se usa en decenas de sitios.

### 2.3 Ciclo de vida y raíz (`Sources/App`, I0→M4)

```swift
// AppDelegate.swift
import AVFoundation
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions opciones: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        MigracionClaves.ejecutar(UserDefaults.standard)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
        return true
    }

    // Sin `configurationForConnecting`: la escena la declara Info.plist (§1.13.3, corregido en la fase 0.2;
    // `delegateClass = SceneDelegate.self` tardaba ~300 ms en tiparse).

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?)
        -> UIInterfaceOrientationMask {
        ContenedorApp.actual?.estadoVentana.mascaraOrientacion ?? [.portrait, .landscapeLeft, .landscapeRight]
    }
}

// SceneDelegate.swift
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo sesion: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let escena = scene as? UIWindowScene else { return }
        let ventana = UIWindow(windowScene: escena)
        if ModoEjecucion.testsUnitarios {
            ventana.rootViewController = UIViewController()          // la app anfitriona no arranca nada
        } else {
            let contenedor = ContenedorApp.crear()
            ContenedorApp.actual = contenedor
            ventana.overrideUserInterfaceStyle = contenedor.preferencias.estiloVentana
            ventana.rootViewController = HostingRaiz(contenedor: contenedor)
            if let enlace = options.urlContexts.first?.url { contenedor.sesion.abrir(enlace: enlace) }
        }
        window = ventana
        ventana.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts contextos: Set<UIOpenURLContext>) {
        guard let enlace = contextos.first?.url else { return }
        ContenedorApp.actual?.sesion.abrir(enlace: enlace)
    }

    func sceneDidBecomeActive(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .activa) }
    func sceneWillResignActive(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .inactiva) }
    func sceneDidEnterBackground(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .segundoPlano) }
    func sceneWillEnterForeground(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .inactiva) }
}

// HostingRaiz.swift
final class HostingRaiz: UIHostingController<RaizView> {
    private let contenedor: ContenedorApp
    private var vigilante: Task<Void, Never>?

    init(contenedor: ContenedorApp) {
        self.contenedor = contenedor
        super.init(rootView: RaizView(contenedor: contenedor))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("sin storyboard") }

    override var preferredStatusBarStyle: UIStatusBarStyle { contenedor.estadoVentana.estiloBarraEstado }
    override var prefersStatusBarHidden: Bool { contenedor.estadoVentana.barraEstadoOculta }
    override var prefersHomeIndicatorAutoHidden: Bool { contenedor.estadoVentana.inmersivo }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        contenedor.estadoVentana.inmersivo ? .all : []
    }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        contenedor.estadoVentana.mascaraOrientacion
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let estado = contenedor.estadoVentana
        let preferencias = contenedor.preferencias
        vigilante = Task { @MainActor [weak self] in
            let cambios = Observations {   // SIN «@MainActor in»: con la anotación el compilador se cae (§5.3.1, C2)
                (estado.estiloBarraEstado, estado.barraEstadoOculta, estado.inmersivo, estado.mascaraOrientacion,
                 preferencias.tema)
            }
            for await _ in cambios { self?.aplicarEstadoVentana() }
        }
    }

    private func aplicarEstadoVentana() {
        view.window?.overrideUserInterfaceStyle = contenedor.preferencias.estiloVentana
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
```

Plan B de `Observations` (canario 0.1): un bucle `withObservationTracking { lee los cinco } onChange: { Task { @MainActor in
aplicar(); volver a vigilar } }` en el mismo sitio. Ninguna otra pieza cambia.

```swift
// EstadoVentana.swift
@MainActor @Observable final class EstadoVentana {
    var heroeBajoBarra = false          // la agenda con el héroe debajo de la barra de estado (M5 lo publica)
    var fondoOscuroArriba = false       // teatro, emparejar con cámara (M6/M7)
    var inmersivo = false               // M4 lo calcula con Maquetacion.inmersivo
    var mascaraOrientacion: UIInterfaceOrientationMask = [.portrait, .landscapeLeft, .landscapeRight]

    var estiloBarraEstado: UIStatusBarStyle { heroeBajoBarra || fondoOscuroArriba ? .lightContent : .default }
    var barraEstadoOculta: Bool { inmersivo }
}

// PreferenciasLocales.swift — aceneo-tema, aceneo-transparencia, aceneo-pb (a1 §13.10)
enum TemaApp: String, CaseIterable, Sendable {
    case sistema, claro, oscuro
    var estiloUI: UIUserInterfaceStyle {
        switch self {
        case .sistema: .unspecified
        case .claro: .light
        case .oscuro: .dark
        }
    }
}

@MainActor @Observable final class PreferenciasLocales {
    private(set) var tema: TemaApp
    private(set) var transparenciaReducida: Bool
    private(set) var modo: PlaybackMode
    init(_ defaults: UserDefaults = .standard) { … }
    /// Lo que se pide a la ventana. En Debug, -AceNeoApariencia hace de apariencia DEL SISTEMA (como el
    /// prefers-color-scheme de las capturas de la web): el tema arranca en «Sistema» y, mientras siga ahí, manda.
    var estiloVentana: UIUserInterfaceStyle { … }
    func cambiarTema(_ tema: TemaApp) { … }
    func cambiarTransparencia(_ reducida: Bool) { … }
    func cambiarModo(_ modo: PlaybackMode) { … }
}

// CicloVida.swift
enum FaseEscena: Sendable { case activa, inactiva, segundoPlano }

@MainActor @Observable final class CicloVida {
    private(set) var fase: FaseEscena = .inactiva
    private(set) var enSegundoPlanoDesde: Date?
    /// Oyentes de proceso (SesionApp, TiempoReal, Reproductor): (antes, después).
    @ObservationIgnored var alCambiar: [(FaseEscena, FaseEscena) -> Void] = []
    func cambiar(a nueva: FaseEscena) { … }
}

// MigracionClaves.swift [L]
enum Claves {
    static let tema = "aceneo-tema", transparencia = "aceneo-transparencia", modo = "aceneo-pb"
    static let gustosPrimerUso = "aceneo-primer-uso"            // y el resto de a1 §13.10
}
enum MigracionClaves {
    /// Una vez por instalación: claves de la 0.8.0 → las de la web. Idempotente.
    static func ejecutar(_ defaults: UserDefaults) { … }
}
```

```swift
// ContenedorApp.swift — raíz de composición (I0 escribe el cableado entero en la fase 0.3)
@MainActor final class ContenedorApp: EntornoSesionFuentes {
    static var actual: ContenedorApp?

    let entorno: Entorno
    let reloj: any Reloj
    let haptica = Haptica()
    let estadoVentana = EstadoVentana()
    let cicloVida = CicloVida()
    let preferencias: PreferenciasLocales
    let sesion: SesionApp
    let datos: DatosApp
    let tiempoReal: TiempoReal
    let repartidor: RepartidorEventos
    let navegador = Navegador()
    let hojas = CentroHojas()
    let avisos = Avisos()
    let transicion = TransicionTeatro()
    let reproductor: Reproductor
    let presentacion: PresentacionReproductor
    let fuentes: SesionFuentes
    let senales = SenalPartidos()
    let destapados = MarcadoresDestapados()
    let relojCompartido: RelojCompartido
    let bajas: BajasPendientes
    let raiz: Raiz

    /// Entorno.actual() (real, demo o simulado), reloj de -AceNeoReloj y cableado de hooks (§2.5.7).
    static func crear() -> ContenedorApp { … }

    // EntornoSesionFuentes
    var api: APIClient { entorno.api }
    var visor: String { reproductor.visor }
    var tiempoRealAbierto: Bool { tiempoReal.abierto }
}

// RaizView.swift — el cuerpo real va en modificadores pequeños (ValoresRaiz, ObjetosDeInterfaz…) para tiparse
// rápido; en Debug, -AceNeoLaboratorio / -AceNeoSistema ponen LaboratorioView() / SistemaView() (con
// .hojasDeLaApp(contenedor.hojas)) en lugar del ZStack de las dos fases, con el MISMO entorno.
struct RaizView: View {
    let contenedor: ContenedorApp
    @Environment(\.accessibilityReduceMotion) private var reducirMovimiento
    @Environment(\.accessibilityReduceTransparency) private var reducirTransparencia

    var body: some View {
        let c = contenedor
        ZStack {
            if c.raiz.armazonMontado { AppShell() }
            if c.raiz.emparejarMontado { PantallaEmparejar(motivo: c.raiz.motivo) }
        }
        .font(Mona.fuente(15, peso: 450))
        .environment(\.locale, Locale(identifier: "es_ES"))
        .environment(\.modoDemo, ModoEjecucion.demo)
        .environment(\.cristalOpaco, reducirTransparencia || c.preferencias.transparenciaReducida)
        .environment(\.movimientoReducido, reducirMovimiento || ModoEjecucion.movimientoReducido)
        .environment(\.cacheImagenes, c.entorno.imagenes)
        .environment(c.haptica).environment(c.estadoVentana).environment(c.cicloVida).environment(c.preferencias)
        .environment(c.sesion).environment(c.datos).environment(c.tiempoReal).environment(c.navegador)
        .environment(c.hojas).environment(c.avisos).environment(c.transicion).environment(c.reproductor)
        .environment(c.presentacion).environment(c.fuentes).environment(c.senales).environment(c.destapados)
        .environment(c.relojCompartido).environment(c.bajas).environment(c.raiz)
        .modifier(HapticaRaiz(haptica: c.haptica))
        .onChange(of: reducirMovimiento || ModoEjecucion.movimientoReducido, initial: true) { _, v in
            c.haptica.reducirMovimiento = v
        }
    }
}

// Raiz.swift — a2 §22.6 (éxito) y §23.3 (acceso perdido); fundidos de 340 ms entre las dos fases
@MainActor @Observable final class Raiz {
    private(set) var armazonMontado: Bool
    private(set) var emparejarMontado: Bool
    private(set) var motivo: MotivoEmparejar?
    init(faseInicial: FaseSesion) { … }
    func entrarEnLaApp(host: String, reducido: Bool) async { … }   // monta el armazón, funde, toast «Emparejado con {host}»
    func volverAEmparejar(motivo: MotivoEmparejar, reducido: Bool) async { … }
}
```

`Reproductor`, `SesionFuentes`, `DatosApp`… viven en `ContenedorApp` (vida de proceso), nunca dentro de una vista.
`Observable` solo en el entorno; los `let` de configuración se pasan por `init`.

### 2.4 Armazón (`Sources/Armazon`, I0→M4)

#### 2.4.1 Navegador

```swift
enum OrigenApertura: Hashable, Sendable { case heroe(partido: String), tarjeta(partido: String), mini, ninguno }

@MainActor @Observable final class Navegador {
    private(set) var pestana: Pestana = .agenda
    private(set) var capa: Destino?                          // .partido / .canal / .sistema encima de la pestaña
    private(set) var sentido: Sentido = .adelante
    private(set) var visitadas: Set<Pestana> = [.agenda]     // pestañas montadas (vivas) desde su primera visita
    private(set) var subirArriba: [Pestana: Int] = [:]       // +1 al tocar la pestaña activa → su vista sube
    private(set) var origenApertura: OrigenApertura = .ninguno
    private(set) var seccionAjustes: SeccionAjustes?
    private(set) var peticionSeccion = 0                     // +1 cada vez que se pide desplazar a la sección
    var pestanaCanales: PestanaCanales = .favoritos
    var textoBuscar = ""

    var destinoVisible: Destino { … }
    var teatroVisible: Bool { capa?.esTeatro ?? false }

    /// Cambia la ruta. No anima (animan las capas al ver el cambio). Si no cambia nada, no hace nada.
    func ir(_ destino: Destino, desde origen: OrigenApertura = .ninguno) { … }
    /// Pestaña activa → subirArriba[p] += 1 (y sin capa); otra → ir(p) con háptica de selección.
    func tocarPestana(_ p: Pestana) { … }
    /// Quita la capa; sin capa, a la agenda (a2 §2.2).
    func atras() { … }
}
```

Quien toca una tarjeta llama a `navegador.ir(.partido(id: id), desde: .tarjeta(partido: id))`; `CapaPartido` ve el cambio y
ejecuta la transición. Ninguna pantalla llama a `TransicionTeatro` salvo `.piezaVuelo(…)`.

#### 2.4.2 Hojas (la única puerta)

```swift
enum ContextoPegar: Hashable, Sendable { case libre, partido(id: String) }

struct RefCanal: Hashable, Sendable {
    var hash: String
    var titulo: String
    var coleccion: LibraryCollection?
    var ih: Bool?
}

enum DetentsHoja: Sendable { case medido, grande, medioYGrande }

enum Hoja: Identifiable, Hashable, Sendable {
    case gustos
    case pegar(ContextoPegar)
    case reportar(hash: String, numero: Int)
    case encontrarCanal
    case guardarFavorito(RefCanal)
    case renombrar(RefCanal)
    case ayuda
    case otroServidor(PairingLink)
    case muestra(HojaMuestra)        // galería y banco (P): reproducirOtroHash (sm) · atajos (.grande) · haptica

    var id: String { … }
    var tamano: TamanoHoja { … }
    var detents: DetentsHoja {
        switch self {
        case .gustos, .ayuda, .muestra(.atajos): .grande
        case .encontrarCanal: .medioYGrande
        default: .medido
        }
    }
}

@MainActor @Observable final class CentroHojas {
    var actual: Hoja?
    /// Sustituye a la que haya (la web nunca apila hojas).
    func abrir(_ hoja: Hoja) { … }
    /// ✕, «Cancelar» o fin de una acción.
    func cerrar() { … }
    /// onDismiss: true si se cerró arrastrando (→ háptica media, a1 §8.1).
    func alDescartar() -> Bool { … }
}

/// Qué pinta cada hoja. Los contenidos son de los módulos (stubs de I0).
struct VistaHoja: View {
    let hoja: Hoja
    var body: some View {
        switch hoja {
        case .gustos: ContenidoGustos()                                                   // M5
        case .pegar(let contexto): ContenidoPegar(contexto: contexto)                     // M5
        case .reportar(let hash, let numero): ContenidoReportar(hash: hash, numero: numero) // M6
        case .encontrarCanal: ContenidoEncontrarCanal()                                   // M6
        case .guardarFavorito(let canal): ContenidoGuardarFavorito(canal: canal)          // M5
        case .renombrar(let canal): ContenidoRenombrar(canal: canal)                      // M5
        case .ayuda: ContenidoAyuda()                                                     // M7
        case .otroServidor(let enlace): ContenidoOtroServidor(enlace: enlace)             // M7
        case .muestra(let muestra): ContenidoHojaMuestra(muestra: muestra)               // P (Palco/Galeria)
        }
    }
}

extension View {
    /// El ÚNICO `.sheet(` de la app (en AppShell y en PantallaEmparejar): detents medidos (.height) o .large o
    /// [.medium, .large], asa visible, fondo opaco Palco.glassSolid, radio 24, contenido desplazable.
    func hojasDeLaApp(_ centro: CentroHojas) -> some View { modifier(ModificadorHojas(centro: centro)) }
}

private struct ModificadorHojas: ViewModifier {
    @Bindable var centro: CentroHojas
    @Environment(Haptica.self) private var haptica
    @State private var altoMedido: CGFloat = 320
    func body(content: Content) -> some View {
        content.sheet(item: $centro.actual, onDismiss: { if centro.alDescartar() { haptica.disparar(.media) } }) { hoja in
            VistaHoja(hoja: hoja)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { altoMedido = $0 }
                .presentationDetents(detents(hoja.detents))
                .presentationDragIndicator(.visible)
                .presentationBackground(Palco.glassSolid)
                .presentationCornerRadius(24)
                .presentationContentInteraction(.scrolls)
        }
    }
    private func detents(_ d: DetentsHoja) -> Set<PresentationDetent> {
        switch d {
        case .medido: [.height(altoMedido)]
        case .grande: [.large]
        case .medioYGrande: [.medium, .large]
        }
    }
}
```

`ContenidoHoja` (Palco) pinta título, descripción, cuerpo y pie con los textos de la web; el asa y el gesto son los del
sistema. El canario 0.1 «hoja medida» decide si `.height` medido se queda o pasa a `.fraction` fija por hoja (plan B).

#### 2.4.3 Menús (la única puerta)

```swift
struct AccionMenu: Identifiable {
    let opcion: OpcionMenu
    let ejecutar: () -> Void
    var id: String { opcion.id }
    init(_ opcion: OpcionMenu, ejecutar: @escaping () -> Void) { self.opcion = opcion; self.ejecutar = ejecutar }
}

/// Sections por `separadaAntes`; `Button(role: .destructive)` si `peligro`; `Toggle` si `marcada`;
/// `Label { Text } icon: { Image(uiImage: IconoImagen.imagen(…)) }`; dispara `opcion.haptica` al ejecutar.
struct ContenidoMenu: View {
    let acciones: [AccionMenu]
    var body: some View { … }
}

extension View {
    /// El ÚNICO `.contextMenu(` de la app. Las mismas acciones van a `accessibilityActions` (VoiceOver).
    func menuContextual(_ acciones: [AccionMenu]) -> some View { … }
    func menuContextual<Previa: View>(_ acciones: [AccionMenu], @ViewBuilder vistaPrevia: @escaping () -> Previa) -> some View { … }
}

/// El botón ⋯ de la web: `Menu { ContenidoMenu } label: { BotonIcono(.more) }` con `.menuOrder(.fixed)`.
struct BotonMas: View {
    enum Estilo: Sendable { case fantasma, video }
    init(etiqueta: String = "Más opciones", estilo: Estilo = .fantasma, acciones: @escaping () -> [AccionMenu]) { … }
    var body: some View { … }
}
```

#### 2.4.4 Avisos

```swift
struct AccionAviso {
    var titulo: String
    var hacer: () -> Void
}

/// notify() de la web: decide toast o línea de estado, lleva los relojes y guarda las acciones.
@MainActor @Observable final class Avisos {
    private(set) var cola = ColaToasts()
    private(set) var linea = LineaEstado()
    var viendoTeatro = false          // `watching`
    var inmersivo = false

    @discardableResult
    func avisar(_ texto: String, clase: ClaseAviso = .accion, tono: TonoAviso = .info, icono: NombreIcono? = nil,
                senal: EstadoSenal? = nil, dato: String? = nil, accion: AccionAviso? = nil,
                duracion: Double? = nil) -> DestinoAviso { … }
    func fijarBase(_ base: ContenidoLinea?) { … }
    func vaciarLinea() { … }
    func ejecutarAccion(_ id: Int) { … }
    func cerrar(_ id: Int) { … }
}
```

#### 2.4.5 Transición card → teatro

```swift
enum PiezaVuelo: Hashable, Sendable { case tarjeta, escudos, filaEquipos, escenario }
struct ClaveMarco: Hashable, Sendable { var pieza: PiezaVuelo; var partido: String }

@MainActor @Observable final class TransicionTeatro {
    @ObservationIgnored private(set) var marcos: [ClaveMarco: CGRect] = [:]   // coordenadas de la ventana
    private(set) var progreso: Double = 1        // 0 = en el origen, 1 = teatro colocado
    private(set) var ida = true
    private(set) var activa = false
    func publicar(_ marco: CGRect, para clave: ClaveMarco) { … }
    func olvidar(_ clave: ClaveMarco) { … }
    /// Ida (§3.5): zoom de la capa desde el origen + vuelo de escudos (plusLighter), muelle estándar.
    func abrir(_ destino: Destino, desde origen: OrigenApertura, reducido: Bool) async { … }
    /// Vuelta de la web: el teatro se funde, la pestaña entra desde −16, los escudos vuelven,
    /// y el vídeo vuela al mini si sigue sonando.
    func cerrar(haciaMini: Bool, desde marcoVideo: CGRect?, reducido: Bool) async { … }
}

extension View {
    /// Publica el marco de esta pieza (onGeometryChange en .global) y lo olvida al desaparecer. HECHO en el
    /// cierre de la fase 0 (canario C15: el marco sigue al desplazamiento; LaboratorioUITests, bloque 8).
    func piezaVuelo(_ pieza: PiezaVuelo, partido: String) -> some View { … }
}
```

#### 2.4.6 `AppShell` (orden de capas, M4)

```
ZStack (ignora las zonas seguras; mide Maquetacion con onGeometryChange: tamaño + safeAreaInsets)
├─ CapaPestanas            z 0     las 4 pestañas visitadas, vivas; solo la actual visible e interactiva
├─ CapaPartido             z 20    TeatroView(destino:) cuando capa es .partido/.canal; SistemaView si .sistema
├─ VeloInferior            z 39    móvil, con barra
├─ BarraPestanas           z 40    móvil (Maquetacion.barraInferior) · BarraSuperior en tableta
├─ CapaMini                z 41    MiniReproductor si presentacion.miniVisible
├─ CapaVuelo               z 45    escudos y VueloVideo durante la transición
├─ CapaAvisos              z 60    toasts (la línea de estado la pinta el teatro)
└─ CapaInmersiva           z 100   EscenarioVideo(inmersivo: true) cuando Maquetacion.inmersivo
.hojasDeLaApp(hojas)
```

### 2.5 Datos (`Sources/Core/Datos`, I0→M1)

#### 2.5.1 Consulta

```swift
enum AlVolverActiva: Sendable { case siempre, soloSinTiempoReal, nunca }

struct PoliticaConsulta: Sendable {
    var frescuraConTiempoReal: Duration? = nil       // nil = no caduca (el SSE avisa)
    var frescuraSinTiempoReal: Duration = .seconds(30)
    var reintentos = 2                                // a 1 s y 2 s, solo si el error es reintentable
    var alVolverActiva: AlVolverActiva = .soloSinTiempoReal
    var siempreAlMontar = false

    static let porDefecto = PoliticaConsulta()
    static let agenda = PoliticaConsulta(frescuraConTiempoReal: .seconds(600), frescuraSinTiempoReal: .seconds(600),
                                         alVolverActiva: .siempre)
    static let marcadores = PoliticaConsulta(frescuraConTiempoReal: .seconds(5), frescuraSinTiempoReal: .seconds(5),
                                             alVolverActiva: .nunca)
    static let alMontar = PoliticaConsulta(siempreAlMontar: true)
    static let busqueda = PoliticaConsulta(frescuraConTiempoReal: .seconds(60), frescuraSinTiempoReal: .seconds(60),
                                           reintentos: 0)
}

@MainActor @Observable final class Consulta<Valor: Sendable> {
    private(set) var datos: Valor?
    private(set) var error: APIError?
    private(set) var cargando = false
    private(set) var actualizadaEn: Date?
    private(set) var observadores = 0
    let politica: PoliticaConsulta
    private let pedir: @Sendable () async throws -> Valor      // `let`: la macro no lo observa
    @ObservationIgnored private var enVuelo: Task<Void, Never>?

    init(_ politica: PoliticaConsulta = .porDefecto, pedir: @escaping @Sendable () async throws -> Valor) { … }
    func caducada(tiempoRealAbierto: Bool, ahora: Date) -> Bool { … }
    /// Pide si no hay datos o están caducados; si ya hay una petición en vuelo, espera a esa.
    func asegurar(tiempoRealAbierto: Bool) async { … }
    /// «Actualizar» y tirar para actualizar: pide siempre.
    func refrescar() async { … }
    /// Caduca; si alguien la mira, vuelve a pedir (como TanStack con consultas activas).
    func invalidar() { … }
    func escribir(_ valor: Valor) { … }
    func vaciar() { … }
    func empezarAMirar() { … }
    func dejarDeMirar() { … }
}

extension View {
    /// Mira una consulta mientras la vista está en pantalla Y `vistaActiva` (pestaña visible).
    func mira<V: Sendable>(_ consulta: Consulta<V>) -> some View { … }
}
```

#### 2.5.2 DatosApp

```swift
@MainActor @Observable final class DatosApp {
    let arranque: Consulta<BootstrapResponse>
    let agenda: Consulta<FootballSchedule>
    let biblioteca: Consulta<LibraryView>
    let preferencias: Consulta<PreferencesResponse>
    let ajustes: Consulta<SettingsResponse>
    let directorios: Consulta<DirectoryView>
    let motor: Consulta<EngineStatus>
    let reproduccion: Consulta<PlaybackStatus>
    let marcadores: Consulta<ScoresResponse>
    let dispositivos: Consulta<DevicesListResponse>
    let salud: Consulta<HealthResponse>
    let diagnosticos: Consulta<DiagnosticsListResponse>
    private(set) var precalentados: [String: Consulta<PreheatResponse>] = [:]
    private(set) var trabajos: [String: Consulta<ScanJob>] = [:]
    private(set) var busquedas: [String: Consulta<SearchResponse>] = [:]
    var tiempoRealAbierto = false

    init(api: APIClient, cache: DiskCache) { … }
    func sembrar(con arranque: BootstrapResponse) { … }        // biblioteca, preferencias y ajustes salen del arranque
    func pintarEnFrio() async { … }                           // DiskCache: agenda, biblioteca, arranque, preferencias
    func invalidar(_ rutas: Set<RutaConsulta>) { … }
    func invalidarTodo() { … }
    func vaciar() { … }                                        // olvidar este iPhone
    func precalentado(partido id: String) -> Consulta<PreheatResponse> { … }
    func trabajo(_ id: String) -> Consulta<ScanJob> { … }
    func busqueda(_ q: String) -> Consulta<SearchResponse> { … }

    // Mutaciones (a7 §4.3): escritura directa con la respuesta + invalidación de lo que dependa.
    func mutarBiblioteca(_ cambio: LibraryMutation) async throws { … }
    func guardarPreferencias(_ cuerpo: PreferencesInput) async throws { … }
    func guardarAjustes(_ cuerpo: SettingsUpdateBody) async throws { … }
    func sincronizarLista(_ cuerpo: DirectorySyncBody) async throws { … }
    func activarLista(id: String) async throws { … }
    func borrarLista(id: String) async throws { … }
    func reiniciarMotor() async throws -> EngineRestartResponse { … }
    func revocar(dispositivo id: String) async throws { … }
    func crearCodigo(_ cuerpo: PairingCreateBody) async throws -> PairingCreateResponse { … }
}
```

#### 2.5.3 Tiempo real y eventos

```swift
enum EstadoTiempoReal: Sendable { case inactivo, conectando, abierto, respaldo, demo }

@MainActor @Observable final class TiempoReal {
    private(set) var estado: EstadoTiempoReal = .inactivo
    @ObservationIgnored private(set) var ultimoId: String?
    @ObservationIgnored var alEvento: ((SSEEvent) -> Void)?
    @ObservationIgnored var alAbrirTrasCorte: (() -> Void)?     // invalida playbackStatus y engineStatus
    @ObservationIgnored var alPerderAcceso: (() -> Void)?
    init(cliente: SSEClient, esDemo: Bool) { … }
    var abierto: Bool { estado == .abierto }
    func arrancar() { … }              // 10 s sin abrir → .respaldo
    func parar() { … }
    func reconectarYa() { … }          // cambio de red, vuelta a primer plano
    func pasoASegundoPlano(suena: Bool) { … }
}

@MainActor final class RepartidorEventos {
    init(datos: DatosApp, tiempoReal: TiempoReal, sesion: SesionApp, reproductor: Reproductor, fuentes: SesionFuentes,
         senales: SenalPartidos, avisos: Avisos, cicloVida: CicloVida) { … }
    func arrancar() { … }              // engancha tiempoReal.alEvento; sondeo 5 s (reproducción) y 20 s (motor) en .respaldo
    func parar() { … }
    func aplicar(_ evento: SSEEvent) { … }        // EfectosEvento.de(evento) → a cada dueño
    func escuchar(_ oyente: @escaping (SSEEvent) -> Void) -> Int { … }
    func dejarDeEscuchar(_ id: Int) { … }
}
```

#### 2.5.4 Sesión

```swift
enum MotivoEmparejar: Hashable, Sendable {
    case olvidadoAqui, revocadoDesdeOtro, noAutorizado, dispositivoRetirado, llaveroIlegible
}
enum FaseSesion: Hashable, Sendable { case emparejar(MotivoEmparejar?), app }
enum EstadoConexion: Hashable, Sendable { case conectando, conectado(ServerVia), sinServidor, backendNoDisponible }

@MainActor @Observable final class SesionApp {
    private(set) var fase: FaseSesion
    private(set) var conexion: EstadoConexion = .conectando
    private(set) var dispositivo: String?
    private(set) var versionServidor: String?
    private(set) var capacidades = Capacidades()
    private(set) var olvidando = false
    /// aceneo://pair con la app ya emparejada → hoja «¿Emparejar con otro servidor?».
    var enlacePendiente: PairingLink?
    @ObservationIgnored var alPerderAcceso: ((MotivoEmparejar) -> Void)?

    init(entorno: Entorno) { … }
    func arrancar() async { … }                    // hay token → .app y arranque; si no, .emparejar(nil)
    func emparejado(_ respuesta: PairingClaimResponse, servidores: [URL]) async { … }
    func abrir(enlace: URL) { … }
    func accesoPerdido(_ motivo: MotivoEmparejar) async { … }   // borra el token, conserva direcciones (a9 §3.3)
    func olvidarEsteIPhone() async { … }           // revoca el propio, borra token y cachés, vuelve a emparejar
    func volvioAPrimerPlano() { … }
    func pasoASegundoPlano() { … }
    func anotar(_ error: APIError, en ruta: RutaAdministracion) { … }
}
```

#### 2.5.5 Piezas de proceso (M1)

```swift
@MainActor @Observable final class SenalPartidos {           // scan.progress por partido, 20 min
    func senal(partido id: String) -> ScanProgressData? { … }
    func anotar(_ progreso: ScanProgressData, ahora: Date) { … }
}
@MainActor @Observable final class MarcadoresDestapados {
    func destapado(_ partido: String) -> Bool { … }
    func destapar(_ partido: String) { … }
    func tapar(_ partido: String) { … }                      // (M5, contrato aditivo) segundo toque en «Marcador»
    func vaciar() { … }
}
@MainActor @Observable final class RelojCompartido {         // tic de 20 s mientras haya quien mire
    private(set) var ahora: Date
    init(reloj: any Reloj, periodo: Duration = .seconds(20)) { … }
    func empezarAMirar() { … }
    func dejarDeMirar() { … }
}
@MainActor @Observable final class BajasPendientes {         // «Deshacer» 6 s
    func quitar(_ canal: RefCanal, datos: DatosApp, avisos: Avisos) { … }
    func pendiente(_ hash: String) -> Bool { … }
}
@MainActor final class VigiaRed { init(servidores: ServerResolver, alCambiar: @escaping () -> Void) { … } }
@MainActor final class VigiaVersion { init(api: APIClient, avisos: Avisos) { … }; func revisar(motivo: String) async { … } }
```

#### 2.5.6 Demo y argumentos

```swift
// Debug/ServidorDemo.swift (M2)
#if DEBUG
struct OpcionesSimulado: Sendable {
    var sinEmparejar = false          // arranca en Emparejar
    var tiempoReal = false            // SSEDemo en vez de modo demo sin SSE
    var reloj: Date?                  // ancla del reloj (T0 = 2026-09-24T19:00:00+02:00)
    var semilla: UInt64 = 1
}
enum ServidorDemo {
    static func entorno(opciones: OpcionesSimulado) -> Entorno { … }
}
#endif
```

#### 2.5.7 Cableado que escribe I0 en `ContenedorApp.crear()`

1. `entorno = Entorno.actual()`; `reloj = RelojDesplazado(inicio:)` si hay `-AceNeoReloj`, si no `RelojSistema()`.
2. `sesion.alPerderAcceso = { motivo in Task { await raiz.volverAEmparejar(motivo:reducido:); reproductor.detener() } }`.
3. `tiempoReal.alEvento = repartidor.aplicar`; `tiempoReal.alPerderAcceso = { Task { await sesion.accesoPerdido(.noAutorizado) } }`.
4. `fuentes.conectar(contenedor)`; `reproductor.alFallarFuente = { [weak fuentes] in fuentes?.alFallarFuente($0) ?? false }`;
   `reproductor.sistema = ControlesSistema(…)`.
5. `cicloVida.alCambiar += [sesion…, tiempoReal…, reproductor…]` (a8 §3.5).
6. `datos.tiempoRealAbierto` sigue a `tiempoReal.estado` (lo hace el repartidor).

### 2.6 Reproducción (`Sources/Player`, I0→M3)

```swift
// SuperficieVideo.swift (cambia)
public enum PrioridadHueco: Int, Sendable, Comparable {
    case mini = 1, teatro = 2, inmersivo = 3, vuelo = 4
    public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}
// VistaVideo(superficie:prioridad:gravedad:) se queda igual: el hueco de más prioridad en pantalla se lleva la capa.

// PresentacionReproductor.swift
enum LugarVideo: Sendable { case ninguno, mini, teatro, inmersivo, vuelo }

@MainActor @Observable final class PresentacionReproductor {
    private(set) var controlesVisibles = true
    private(set) var pantallaCompletaForzada = false
    private(set) var datosTecnicosAbiertos = false
    private(set) var cortes = 0                           // +1 → CorteNegro (560 ms) al cambiar de fuente
    var voiceOverActivo = false
    init(reproductor: Reproductor) { … }
    func lugar(teatroVisible: Bool, inmersivo: Bool, volando: Bool) -> LugarVideo { … }
    func miniVisible(teatroVisible: Bool, inmersivo: Bool) -> Bool { … }
    func tocarVideo() { … }
    func interaccionConControles() { … }                  // autoocultado 3,2 s solo reproduciendo y nunca con VoiceOver
    func alternarPantallaCompleta() { … }                  // Orientacion.pedir(.landscapeRight / .portrait)
    func abrirDatosTecnicos() { … }
    func cerrarDatosTecnicos() { … }
    func fuenteCambiada() { … }
}

// Fuentes/SesionFuentes.swift — sources/session.ts entero (sustituye a CentroPartidoModelo)
@MainActor protocol EntornoSesionFuentes: AnyObject {
    var api: APIClient { get }
    var reproductor: Reproductor { get }
    var avisos: Avisos { get }
    var haptica: Haptica { get }
    var hojas: CentroHojas { get }
    var reloj: any Reloj { get }
    var visor: String { get }
    var tiempoRealAbierto: Bool { get }
}

enum FaseSesionFuentes: Sendable { case reposo, resolviendo, lista, opciones, noEncontrado, sinCanales }

@MainActor @Observable final class SesionFuentes {
    private(set) var clave: String?                       // "partido:<id>" · "canal:<hash>"
    private(set) var fase: FaseSesionFuentes = .reposo
    private(set) var entradas: [EntradaFuente] = []
    private(set) var activa: String?
    private(set) var trabajo: ScanJob?
    private(set) var resolucion: Resolution?
    private(set) var automatico = true
    private(set) var eleccionManual = false
    private(set) var rebuscando = false
    private(set) var detenida = false
    private(set) var textoFallo: String?
    private(set) var textoEspera: String?
    private(set) var otrasSenales: [ResolutionCandidate] = []    // canal suelto (añadido de Isma)
    private(set) var buscandoOtras = false

    @ObservationIgnored private weak var entorno: (any EntornoSesionFuentes)?

    init() {}
    /// Dos fases: el contenedor se crea y luego se presenta (evita el ciclo en el init). Los tests pasan un doble.
    func conectar(_ entorno: any EntornoSesionFuentes) { self.entorno = entorno }
    func entrarPartido(_ partido: FootballMatch) async { … }
    func entrarCanal(_ canal: RefCanal, listaActiva: String?) async { … }
    func salirVista() { … }                    // la vista se va; la política sigue viva mientras suene
    func elegir(_ hash: String) { … }          // manual: ya nunca salta sola
    func paso(_ delta: Int) { … }              // ‹ › de la barra «emitiendo»
    func pegar(_ texto: String) async throws { … }
    func rebuscar() async { … }
    func reportar(_ hash: String, motivo: SourceReportReason) async throws { … }
    func confirmar(_ hash: String) async { … }
    func elegirCandidata(_ candidata: ResolutionCandidate) async { … }
    func vincularManual(_ hash: String) async throws { … }
    func procesar(_ evento: SSEEvent) { … }
    func alFallarFuente(_ fallo: FalloFuente) -> Bool { … }
    var visibles: [EntradaFuente] { … }
    var plegadas: [EntradaFuente] { … }
}
```

`Reproductor` conserva su API pública de hoy menos la presentación (`expandido`, `superficiesGrandes`, `visibleEnMini`,
`vista`, `expandir()`, `minimizar()`, `superficieGrande(visible:)` pasan a `PresentacionReproductor`).

### 2.7 Identificadores de interfaz — `Armazon/IdentificadoresUI.swift` (I0→M4, compilado también en UITests)

```swift
/// Los mismos textos en la app (.accessibilityIdentifier) y en las pruebas. Solo String: nada de tipos de la app.
enum IDUI {
    // Armazón
    static let armazon = "armazon"                                             // (0.3b)
    static let barraPestanas = "barra-pestanas", barraSuperior = "barra-superior"
    static func pestana(_ id: String) -> String { "pestana-\(id)" }          // agenda · biblioteca · buscar · ajustes
    /// La raíz de cada pantalla (agenda · biblioteca · buscar · ajustes · emparejar · sistema) (0.3b).
    static func pantalla(_ id: String) -> String { "pantalla-\(id)" }
    static let mini = "mini-reproductor", miniPausa = "mini-pausa", miniDetener = "mini-detener", miniDonde = "mini-donde"
    static let toastAccion = "toast-accion", toastCerrar = "toast-cerrar", capsulaEstado = "capsula-estado"
    // Emparejar (a2 §22.9)
    static let visorCamara = "visor-camara", botonAjustesCamara = "boton-ajustes-camara"
    static let botonEscribirCodigo = "boton-escribir-codigo", campoCodigo = "campo-codigo"
    static let campoLan = "campo-lan", campoTailscale = "campo-tailscale", botonEmparejar = "boton-emparejar"
    static let errorEmparejar = "error-emparejar", avisoAcceso = "aviso-acceso"
    static let hojaOtroServidor = "hoja-otro-servidor", botonEmparejarDeNuevo = "boton-emparejar-de-nuevo"
    // Agenda
    static let heroe = "heroe", botonVerAhora = "boton-ver-ahora", tiraDias = "tira-dias"
    static func dia(_ fecha: String) -> String { "dia-\(fecha)" }             // AAAA-MM-DD
    static let filtroParaTi = "filtro-para-ti", filtroTodos = "filtro-todos"
    static func tarjetaPartido(_ id: String) -> String { "tarjeta-partido-\(id)" }
    static let botonActualizarAgenda = "boton-actualizar-agenda", tarjetaPrimerUso = "tarjeta-primer-uso"
    static let botonEditarGustos = "boton-editar-gustos", hojaGustos = "hoja-gustos"
    // Teatro
    static let teatro = "teatro", videoTeatro = "video-teatro", botonMinimizar = "boton-minimizar"
    static let capsulaMarcador = "capsula-marcador", botonFavorito = "boton-favorito", botonPip = "boton-pip"
    static let botonMasOpciones = "boton-mas-opciones", botonPausa = "boton-pausa", botonRetroceder = "boton-retroceder"
    static let botonSilencio = "boton-silencio", botonDirecto = "boton-directo"
    static let botonPantallaCompleta = "boton-pantalla-completa"
    static let cabeceraPartido = "cabecera-partido", cabeceraCanal = "cabecera-canal"
    static let pestanaFuentes = "pestana-fuentes", pestanaPartido = "pestana-partido", pestanaDatos = "pestana-datos"
    static func cartelFuente(_ n: Int) -> String { "cartel-fuente-\(n)" }
    static let barraEmitiendo = "barra-emitiendo", panelDatosTecnicos = "panel-datos-tecnicos"
    static let otrasSenales = "otras-senales"
    static let hojaReportar = "hoja-reportar", hojaEncontrarCanal = "hoja-encontrar-canal"
    // Canales, Buscar, Pegar
    static let buscadorBiblioteca = "buscador-biblioteca", emitiendoAhora = "emitiendo-ahora"
    static let pestanaFavoritos = "pestana-favoritos", pestanaRecientes = "pestana-recientes", pestanaListas = "pestana-listas"
    static func filaCanal(_ hash: String) -> String { "fila-canal-\(hash)" }
    static func categoria(_ nombre: String) -> String { "categoria-\(nombre)" }
    static let campoBuscar = "campo-buscar", enlaceDetectado = "enlace-detectado"
    static func resultado(_ hash: String) -> String { "resultado-\(hash)" }
    static let hojaPegar = "hoja-pegar", campoHash = "campo-hash", botonPegarPortapapeles = "boton-pegar-portapapeles"
    static let hojaGuardarFavorito = "hoja-guardar-favorito", hojaRenombrar = "hoja-renombrar"   // (0.3b)
    // Ajustes
    static let indiceAjustes = "indice-ajustes"
    static func chip(_ seccion: String) -> String { "chip-\(seccion)" }
    static func seccion(_ id: String) -> String { "seccion-\(id)" }
    static func filaDispositivo(_ id: String) -> String { "fila-dispositivo-\(id)" }
    static let filaEsteIPhone = "fila-este-iphone", botonOlvidarEsteIPhone = "boton-olvidar-este-iphone"
    static let versionApp = "version-app", visorEsteDispositivo = "visor-este-dispositivo"
    static func sesion(_ id: String) -> String { "sesion-\(id)" }
    static let hojaAyuda = "hoja-ayuda"                                        // (0.3b)
}
```

Regla: todo control que toque una prueba lleva `IDUI`; los textos visibles **no** se usan como selector salvo para
comprobar el texto.

### 2.8 Entradas de cada pantalla (stubs de I0; cada módulo rellena la suya)

```swift
struct AppShell: View { var body: some View { … } }                                   // M4
struct PantallaEmparejar: View { init(motivo: MotivoEmparejar?) { … } }                // M7
struct AgendaView: View { var body: some View { … } }                                 // M5
struct CanalesView: View { var body: some View { … } }                                // M5
struct BuscarView: View { var body: some View { … } }                                 // M5
struct AjustesView: View { var body: some View { … } }                                // M7
struct TeatroView: View { init(destino: Destino) { … } }                              // M6 (.partido o .canal)
struct EscenarioVideo: View { init(inmersivo: Bool) { … } }                           // M6
struct MiniReproductor: View { var body: some View { … } }                            // M6
struct SistemaView: View { var body: some View { … } }                                // P
struct ContenidoGustos: View { var body: some View { … } }                            // M5
struct ContenidoPegar: View { init(contexto: ContextoPegar) { … } }                   // M5
struct ContenidoGuardarFavorito: View { init(canal: RefCanal) { … } }                 // M5
struct ContenidoRenombrar: View { init(canal: RefCanal) { … } }                       // M5
struct ContenidoReportar: View { init(hash: String, numero: Int) { … } }              // M6
struct ContenidoEncontrarCanal: View { var body: some View { … } }                    // M6
struct ContenidoAyuda: View { var body: some View { … } }                             // M7
struct ContenidoOtroServidor: View { init(enlace: PairingLink) { … } }                // M7
```

Todas leen sus objetos del entorno (`@Environment(DatosApp.self)`, …); ninguna recibe objetos por `init`. Así un módulo
puede montar su pantalla con `ContenedorApp.crear()` en un test o en `-AceNeoEscena` sin tocar a nadie.

---

## 3. Reparto en módulos

### 3.0 Mapa

| Módulo | Qué | Fase | Carpetas exclusivas (resumen) | Espera a | Rama |
|---|---|---|---|---|---|
| **I0** | cimientos: proyecto, CI, linter, poda, contratos, generadores | 0 | `project.yml`, `Package.swift`, `Config/`, workflow, `scripts/revisar-swift.mjs`, `Sources/Sonda` | — | `nativa/cimientos` |
| **P** | Palco: sistema de diseño y laboratorio | 0 (luego soporte) | `Sources/Palco`, `Resources/Fuentes`, `Marca`, generadores de tokens/iconos/fuentes | — (en paralelo con 0.3) | `nativa/palco` |
| **M1** | núcleo de datos | 1 | `Core/{Networking,Auth,Cache,Models,Datos}`, `Core/Reglas/Datos`, `App/Entorno.swift` | fase 0 | `nativa/datos` |
| **M2** | reglas comunes, demo y referencias web | 1 | `Core/Reglas/{Senal,Avisos,Haptica,Gestos,Color,Formatos}`, `Core/Dominio`, `Sources/Debug` (menos Escenas y MotorSimulado) | fase 0 | `nativa/comunes` |
| **M3** | reproducción | 1 | `Sources/Player`, `Core/Reglas/{Fuentes,Reproduccion}`, `Debug/MotorSimulado.swift` | fase 0 | `nativa/reproduccion` |
| **M4** | armazón y ciclo de vida | 1 | `Sources/Armazon`, `Sources/App` (menos Entorno), `Core/Reglas/{Navegacion,Maquetacion,Transicion}` | fase 0 | `nativa/armazon` |
| **M5** | agenda y biblioteca | 1 | `Pantallas/{Agenda,Canales,Buscar,Pegar}`, `Core/Reglas/{Agenda,Biblioteca,Busqueda,Gustos}` | fase 0 | `nativa/agenda` |
| **M6** | teatro y mini | 1 | `Pantallas/{Partido,Mini}` | fase 0 | `nativa/teatro` |
| **M7** | ajustes y emparejar | 1 | `Pantallas/{Ajustes,Emparejar}`, `Core/Emparejar`, `Core/Reglas/{Listas,Donde,Salud,Dispositivos}` | fase 0 | `nativa/ajustes` |
| **M8** | servidor 0.8.1 | 1 (independiente) | `packages/shared`, `apps/server`, `docs/`, `CHANGELOG.md` de la app de Umbrel | — | `nativa/servidor` |
| **I1** | integración | 2 | todo (solo arreglos de integración) | fase 1 | `rediseno/nativa` |
| **I2** | calco | 2 | `Debug/EscenasCaptura.swift`, `Tests/AceNeoUITests/Capturas`, `scripts/comparar-capturas.py`, `CristalPalco.vidrio` (tinte) | I1 en verde | `nativa/calco` |

Reglas comunes a todos los módulos de la fase 1:

- Trabajan **solo** en sus carpetas, más sus pruebas (`Tests/AceNeoTests/<Área>`, `Tests/AceNeoTests/Puros/<Área>`,
  `Tests/AceNeoUITests/Flujos/Flujo<Área>UITests.swift`) y su fichero de vectores (`scripts/vectores/<área>.ts` →
  `Vectores/vectores-<área>.json`).
- Todo lo de otro módulo se consume por su contrato de §2 **tal como está en la rama base** (con stubs si el dueño no ha
  terminado). Si falta algo en un contrato, se pide al integrador (§5.1); no se escribe en carpeta ajena.
- Cada módulo deja sus textos **literales de la web** (ni uno inventado): el catálogo de a7 §12 y los de su área.
- Cada módulo itera con `solo_compilar` (§4.4) y no pide la CI completa hasta que su parte compila.

### 3.1 P · Palco (fase 0.4; después, soporte)

- **Carpetas**: `Sources/Palco/**`, `Resources/Fuentes/**`, `Resources/Assets.xcassets/Marca.imageset`,
  `Core/Reglas/Iconos/**`, `scripts/generar-{tokens,iconos,recursos}.mjs`, `scripts/generar-fuentes.py`,
  `Tests/AceNeoTests/Palco/**`, `Tests/AceNeoUITests/Palco/**`.
- **Especificación**: a1 entero; a2 §24 y §27.5 (subir con la barra de estado); a3 §7 (piezas de tarjeta), a4 §2, a5 §2,
  a6 §1 (piezas base por área, para contrastar).
- **Entra**: `apps/web/src/styles/tokens.css`, `apps/web/src/ui/icons.ts`, los woff2 de `@fontsource-variable`,
  `apps/web/public/icon.svg`; contratos §2.1.3 (NombreIcono, EstadoSenal, TipoHaptico).
- **Sale**: §2.2 entero; `SistemaView`; `LaboratorioView`.
- **Pruebas unitarias**: `TokensTests` (cada token = hex de tokens.css en claro y oscuro, leído del JSON que deja el
  generador), `FuentesTests` (los tres PostScript registrados; avance del «4» a wdth 75 / wght 780 = 0,490 em ± 0,005;
  a wdth 100 / 450 = 0,624 em; `Mona.fuente` con un eje solo **no** existe), `IconosTests` (52 nombres, ningún camino vacío,
  caja 24), `NumTests` (`splitDigits("90+4'")`, anchos de celda), `EstiloTextoTests` (tracking em → pt).
- **UITests**: `LaboratorioUITests` (capturas del banco en claro/oscuro, reducido y normal), `SistemaUITests`.
- **Hecho cuando**: el banco (§4.1.4) está capturado y comparado con la web; los canarios de P (§5.3) marcados; toda
  primitiva sale en `SistemaView` con sus estados.
- **Soporte en la fase 1**: P es el único que toca `Sources/Palco`. Un módulo que necesite una variante nueva la pide con
  un caso concreto (captura de la web + estilo); P la añade sin romper firmas.

### 3.2 M1 · Núcleo de datos

- **Carpetas**: `Core/{Networking,Auth,Cache,Models,Datos}/**`, `Core/Reglas/Datos/**`, `App/Entorno.swift`,
  `scripts/generar-{plazos,rutas}.mjs`, `scripts/generar-catalogo-errores.mjs`, `scripts/vectores/datos.ts`,
  `Tests/AceNeoTests/Nucleo/**`, `Tests/AceNeoTests/Puros/Nucleo/**`.
- **Especificación**: a7 §2-§8 (contrato, cliente HTTP, caché, arranque, SSE, identidad, pantalla a pantalla) y §12.6;
  a8 §3.1-§3.7 y §3.11; a9 §3 y §9 (lo que la app da por hecho de la 0.8.1).
- **Entra**: contratos §2.1.4, §2.5; `Avisos` (M4) solo por su firma.
- **Sale**: `DatosApp`, `Consulta`, `TiempoReal`, `RepartidorEventos`, `SesionApp`, piezas de §2.5.5, rutas 0.8.1,
  modernización de la tabla §1.12 (red, SSE, emparejamiento, caché de imágenes).
- **Pruebas unitarias**: `ConsultaTests` (frescura con y sin SSE, reintentos a 1 s y 2 s solo si `reintentable`, una sola
  petición en vuelo, `invalidar` con y sin observadores, `alVolverActiva`), `DatosAppTests` (sembrar del arranque,
  escrituras directas de cada mutación, `vaciar`), `TiempoRealTests` (estados, 10 s → respaldo, `Last-Event-ID`, esperas
  3-6-12-24-48-60, abrir tras corte invalida reproducción y motor), `RepartidorTests` (cada fila de a7 §6.3 y §6.4 con su
  efecto; eventos dirigidos filtrados por `viewerIds`), `SesionAppTests` (acceso perdido conserva direcciones; olvidar
  este iPhone revoca, borra y vuelve a emparejar sin aviso; `aceneo://pair` emparejada → `enlacePendiente`; 403
  `origin_forbidden` → `capacidades`), `APIClientTests` (plazo total con servidor que gotea, PUT que no se repite, 401
  callado mientras se olvida), `EfectosEventoTests` y `EsperaSSETests` [L].
- **UITests**: ninguno propio; los flujos de M4-M7 lo cubren.
- **Hecho cuando**: todo [L] de M1 pasa en Linux; `DatosApp` sirve a la demo y al servidor real (pila E2E) sin cambios.

### 3.3 M2 · Reglas comunes, demo y referencias web

- **Carpetas**: `Core/Reglas/{Senal,Avisos,Haptica,Gestos,Color,Formatos}/**`, `Core/Dominio/**`, `Sources/Debug/**`
  (salvo `EscenasCaptura.swift` y `MotorSimulado.swift`), `scripts/generar-vectores.ts`, `scripts/generar-demo.ts`,
  `scripts/vectores/{dominio,comunes}.ts`, `Tests/AceNeoTests/Puros/{Dominio,Comunes,Demo}/**`,
  y **en la web** `apps/web/scripts/revision-visual.mjs` (solo las opciones nuevas).
- **Especificación**: a7 §11.2, §11.3, §11.12 (dominio, colores), §12.1 (mecánica de avisos), §13 (demo entera); a1 §2.5
  y §8; a2 §8 (avisos); a8 §3.10 (servidor y motor simulados).
- **Entra**: contratos §2.1.3, §2.1.5, §2.5.6.
- **Sale**: las reglas comunes (color de equipo y canal, formatos en español, avisos, háptica, gestos); `ServidorDemo`,
  `SSEDemo`, `DemoNucleo` con **los mismos datos que `?demo=1`**; los argumentos de §3.3.1; las referencias web
  recapturadas.
- **Pruebas unitarias**: vectores de `color.ts`, `teams.ts`, `channelTone`, formatos, `classifySwipe`, `ColaToasts` y
  `LineaEstado` (casos de `notices.test.tsx`), `Redaccion` (reglas de `wording.test.ts` aplicadas a TODOS los textos del
  catálogo), `DemoGoldenTests` (cada ruta de la demo con el reloj en T0 da el JSON que dio la web).
- **UITests**: ninguno propio.
- **Hecho cuando**: la demo de la app responde byte a byte lo de la web en las rutas de §13 de a7; `revision-visual.mjs
  --reloj … --escala 3 --safe-top 47 --safe-bottom 34` deja las referencias en `capturas/_revision/web-palco/calco/`.

#### 3.3.1 Argumentos de lanzamiento (I0 los declara en `ModoEjecucion`; M2 los hace funcionar)

| Argumento | Efecto (solo Debug) |
|---|---|
| `-AceNeoDemo` | `ServidorDemo` sin SSE y `modoDemo = true` («Modo demo» en vez del motor): igual que `?demo=1` |
| `-AceNeoServidorSimulado` | `ServidorDemo` + `SSEDemo`, sin la cápsula de demo (flujos con tiempo real) |
| `-AceNeoSinEmparejar` | con los dos anteriores: arranca en Emparejar (código de la demo 482913) |
| `-AceNeoReloj <ISO 8601>` | `RelojDesplazado` desde esa hora (capturas: `2026-09-24T19:00:00+02:00`) |
| `-AceNeoEscena <vista>` | `EscenasCaptura` deja la app en esa vista de `final/` (I2) |
| `-AceNeoApariencia claro\|oscuro` | ya existe |
| `-AceNeoTransparenciaReducida` · `-AceNeoMovimientoReducido` | fuerzan esas preferencias |
| `-AceNeoEmpezarDeCero` | ya existe: E2E contra el servidor real, sin token ni cachés |
| `-AceNeoLaboratorio` · `-AceNeoSistema` | abren el banco de la fase 0 o la galería (dentro de `RaizView`, con la demo sin SSE) |
| `-AceNeoDesplazar <pt>` · `-AceNeoLaboratorioSeccion <n>` | el banco o la galería abren desplazados; el banco enseña solo el bloque n (capturas) |

#### 3.3.2 Cómo se genera la demo

`generar-demo.ts` importa la demo real de la web (`agenda/demo-data.ts`, `search/demo.ts`, `health/demo.ts`, las rutas
de `api/demo*.ts`) con tsx, fija `Date` en T0 y siembra `Math.random` (xorshift32, semilla 1), y escribe:
`Debug/DemoNucleo/SemillasDemo.generado.swift` (datos estáticos en JSON base64, bajo `#if DEBUG`) y
`Tests/AceNeoTests/Vectores/demo/demo-<ruta>.json` (respuesta de cada ruta en T0, T0 + 5 min y T0 + 2 h). Lo que depende
del reloj (minuto, marcadores, «hace N min») se porta como código en `DemoNucleo` y el golden lo vigila.

### 3.4 M3 · Reproducción

- **Carpetas**: `Sources/Player/**`, `Core/Reglas/{Fuentes,Reproduccion}/**`, `Sources/Debug/MotorSimulado.swift`, `scripts/generar-textos.mjs`,
  `scripts/vectores/fuentes.ts`, `Tests/AceNeoTests/Reproduccion/**`, `Tests/AceNeoTests/Puros/{Fuentes,Reproduccion}/**`.
- **Especificación**: a7 §9 (reproducción), §10 (política de fuentes), §11.4, §12.3-§12.4; a4 §5.4, §5.6-§5.7, §20, §21;
  a8 §3.8 y §3.11.7-§3.11.9.
- **Entra**: `EntornoSesionFuentes`, `Avisos`, `Haptica`, `CentroHojas` (firmas), `Zapping` (M5, firma).
- **Sale**: `Reproductor` sin presentación, `PresentacionReproductor`, `SesionFuentes` completa (con «Otras fuentes» (§0.0)), `ControlesSistema` (Now Playing y mandos), PiP, AirPlay (`DetectorRutas`), audio en segundo plano,
  `EstadoVisible` (statusFor), las 14 opciones del reproductor y el menú del cartel.
- **Pruebas unitarias**: `ReglasFuentesTests` (vectores de `model.test.ts`), `EstadoVisibleTests`, `OpcionesTests`,
  `TextosTests` (cada texto = `textos-web.json`), `SesionFuentesTests` (entrar, arranque automático, salto de entrada,
  fuente agotada con 3 reconexiones o 1 antes de la primera imagen, manual nunca salta, detener apaga el automatismo,
  zapping fuera de la lista termina la sesión, reportar y seguir el reporte, «Otras fuentes» (§0.0)), `ReproductorTests`,
  `SuperficieYPiPTests` (prioridades nuevas: vuelo gana a todo, inmersivo a teatro, teatro a mini),
  `PresentacionReproductorTests` (autoocultado 3,2 s solo reproduciendo y nunca con VoiceOver), `SistemaTests`.
- **UITests**: ninguno propio (los de M6 lo cubren: el reproductor no tiene pantalla).
- **Hecho cuando**: con `MotorSimulado`, la sesión de fuentes del partido demo arranca sola, cambia de fuente al fallar y
  la pantalla de bloqueo enseña título, subtítulo y mandos de la web.

### 3.5 M4 · Armazón y ciclo de vida

- **Carpetas**: `Sources/Armazon/**`, `Sources/App/**` salvo `Entorno.swift`, `Core/Reglas/{Navegacion,Maquetacion,Transicion}/**`,
  `Tests/AceNeoTests/Armazon/**`, `Tests/AceNeoTests/Puros/Armazon/**`, `Tests/AceNeoUITests/Ayudas/AyudasUI.swift`,
  `Tests/AceNeoUITests/Flujos/FlujoArmazonUITests.swift`.
- **Especificación**: a2 entero salvo §22 (emparejar, M7): §2-§21, §23-§27; a1 §7.5 (transiciones); a4 §3 (gestos
  comunes) y §19.1-§19.3 (colocación del mini).
- **Entra**: todos los contratos (es quien los monta).
- **Sale**: `AppShell` con sus capas; barra de pestañas de la web con `glassEffect` (píldora de oro que se desliza con muelle,
  4 destinos, tocar la activa sube arriba); barra superior en horizontal; hojas, menús y avisos como única puerta;
  transición tarjeta → teatro y su vuelta; borde izquierdo para salir; estado de ventana (barra de estado, indicador,
  orientación); raíz emparejar ↔ app; estados globales (a2 §23).
- **Transición (decisión 3)**:
  - *Ida*: la capa del teatro escala uniformemente desde el marco de origen (tarjeta: radio 14 → 0; héroe: 24 → 0) con el
    muelle estándar; el contenido de la tarjeta se funde (`1 − min(1, 2p)`); los escudos vuelan de `.escudos` a
    `.filaEquipos` en `CapaVuelo` con `plusLighter`; la pestaña de debajo se funde en 340 ms.
  - *Vuelta* (la de la web): el teatro se funde, la pestaña entra desde −16, los escudos vuelven a la tarjeta si sigue en
    pantalla (si no, se funden) y, si algo suena, el vídeo vuela del escenario al mini (hueco `.vuelo`, z 45).
  - *Borde*: `offset(x:)` 1:1 con el dedo; al soltar, `Volver.decide`; si no, vuelve con `Movimiento.soltar(velocidad:)`.
  - *Movimiento reducido*: fundidos de 120 ms, sin zoom ni vuelos.
  - *Plan B* (si el vuelo del vídeo da saltos en el iPhone): el vídeo aparece en el mini al acabar la vuelta, sin volar.
- **Pruebas unitarias**: `DestinoTests` (ida y vuelta de `vista` para todos los casos), `MaquetacionTests` (390×844,
  375×667, 375×812, 402×874, 844×390, 667×375 con sus zonas seguras: barra, mini, toasts, velo, rellenos, inmersivo),
  `GeometriaVueloTests`, `MigracionClavesTests`, `NavegadorTests` (tocar la activa sube; atrás sin capa va a la agenda),
  `CentroHojasTests`, `AvisosTests` (toast o línea según `viendoTeatro`), `EstadoVentanaTests`, `RaizTests`.
- **UITests** (`FlujoArmazonUITests`): cambiar de pestaña y volver conserva el scroll; tocar la pestaña activa sube;
  borde izquierdo sale del partido; hoja con asa se cierra arrastrando; toast con «Deshacer»; giro a 844×390 enseña la
  barra superior.
- **Hecho cuando**: con las pantallas en stub, la app navega entera; las fórmulas de `Maquetacion` casan con las capturas
  de `final/` a ±1 pt en la barra, el mini y los toasts.

### 3.6 M5 · Agenda y biblioteca

- **Carpetas**: `Pantallas/{Agenda,Canales,Buscar,Pegar}/**`, `Core/Reglas/{Agenda,Biblioteca,Busqueda,Gustos}/**`,
  `scripts/vectores/{agenda,biblioteca}.ts`, `Tests/AceNeoTests/Puros/{Agenda,Biblioteca,Busqueda,Gustos}/**`,
  `Tests/AceNeoUITests/Flujos/Flujo{Agenda,Canales,BuscarPegar}UITests.swift`.
- **Especificación**: a3 entero; a5 entero; a7 §8.1, §8.6-§8.8, §8.10, §11.1, §11.5, §11.6, §11.8, §12.5.
- **Entra**: `DatosApp`, `SenalPartidos`, `MarcadoresDestapados`, `RelojCompartido`, `BajasPendientes`, `Navegador`,
  `CentroHojas`, `Avisos`, `Haptica`, `SesionFuentes` (para «Ver canal»), `.piezaVuelo`, `.menuContextual`, Palco.
- **Sale**: `AgendaView` (héroe, tira de días, filtro, grupos, tarjetas, marcadores con cifras que ruedan, tirar para
  actualizar, primer uso), `ContenidoGustos`, `CanalesView` (emitiendo ahora, favoritos / recientes / listas, categorías,
  «Deshacer»), `BuscarView`, `ContenidoPegar`, `ContenidoGuardarFavorito`, `ContenidoRenombrar`; `Zapping` para M3.
- **Pruebas unitarias**: vectores de `domain.ts`, `cards.ts`, `score-reveal.ts`, `for-you.ts`, `library/model.ts`,
  `on-air.ts`, `zapping.ts`, `search/model.ts`, `preferences/model.ts`, más los casos de sus `.test.ts`.
- **UITests**: `FlujoAgendaUITests` (día siguiente deslizando; filtro «Para ti»; destapar marcador; tirar para actualizar;
  gustos desde el lápiz; tarjeta → teatro), `FlujoCanalesUITests` (favorito con «Deshacer»; renombrar; listas),
  `FlujoBuscarPegarUITests` (buscar «dazn»; enlace detectado; pegar un hash del portapapeles).
- **Hecho cuando**: `agenda`, `biblioteca-*`, `buscar`, `buscar-enlace`, `pegar` y `preferencias` pasan la comparación de
  I2 en los dos temas.

### 3.7 M6 · Teatro y mini

- **Carpetas**: `Pantallas/{Partido,Mini}/**`, `Tests/AceNeoTests/Teatro/**`,
  `Tests/AceNeoUITests/Flujos/Flujo{Teatro,Mini}UITests.swift`.
- **Especificación**: a4 entero; a2 §7 (mini y barra), §16.5 y §16.6.4 (inmersivo); a7 §8.2-§8.5.
- **Entra**: `SesionFuentes`, `Reproductor`, `PresentacionReproductor`, `SuperficieVideo`/`VistaVideo`, `DatosApp`,
  `Navegador`, `CentroHojas`, `Avisos`, `TransicionTeatro` (solo `.piezaVuelo`), Palco.
- **Sale**: `TeatroView` (partido y canal suelto), `EscenarioVideo` (vertical e inmersivo), controles del vídeo, cápsulas,
  pestañas Fuentes · Partido · Datos técnicos, carteles de fuente con menú contextual, «Otras fuentes» (calcado de la web, §0.0 punto 1),
  `ContenidoReportar`, `ContenidoEncontrarCanal`, `MiniReproductor`.
- **Gestos (decisión 3)**, todos en `CapaToquesVideo` salvo el mini:
  - toque: controles; **doble toque**: pantalla completa (el toque simple exige que falle el doble);
  - arrastrar abajo el vídeo: minimizar (1:1, `Deslizamiento.clasificar`), solo en vertical y fuera del inmersivo;
  - deslizar de lado el vídeo: fuente anterior/siguiente (`SesionFuentes.paso`), con bloqueo de eje de 8 pt;
  - mini: arriba abre, abajo descarta (umbral 72, `fuerte` al cruzar), lados cambian de fuente.
- **Pruebas unitarias**: `VarianteEscenarioTests` (369/419/479/579 y compacto).
- **UITests**: `FlujoTeatroUITests` (abrir partido demo, elegir fuente, reportar, datos técnicos, doble toque a
  pantalla completa y vuelta, deslizar de lado cambia de fuente, borde izquierdo sale con el mini sonando),
  `FlujoMiniUITests` (tocar abre; deslizar abajo descarta; pausa y detener).
- **Hecho cuando**: `partido`, `reproductor`, `mini-reproductor` y `biblioteca-sonando` pasan la comparación en los dos
  temas y el partido a 844×390 (inmersivo) en oscuro.

### 3.8 M7 · Ajustes y emparejar

- **Carpetas**: `Pantallas/{Ajustes,Emparejar}/**`, `Core/Emparejar/**`, `Core/Reglas/{Listas,Donde,Salud,Dispositivos}/**`,
  `scripts/vectores/ajustes.ts`, `Tests/AceNeoTests/Ajustes/**`, `Tests/AceNeoTests/Puros/{Listas,Donde,Salud,Dispositivos}/**`,
  `Tests/AceNeoUITests/Flujos/Flujo{Emparejar,Ajustes}UITests.swift`.
- **Especificación**: a6 entero **salvo §8 bis** (Servidor, fuera por A-1); a2 §22 (emparejar) y §23.3; a9 §3.5 (interfaz de
  «Olvidar este iPhone» y «revocado desde otro dispositivo»); a7 §8.9, §11.7, §11.9-§11.11.
- **Entra**: `DatosApp`, `SesionApp`, `RepartidorEventos.escuchar`, `PreferenciasLocales`, `Navegador`, `CentroHojas`,
  `Avisos`, `SegundoToque`, Palco.
- **Sale**: `AjustesView` con las 9 secciones y el índice de chips; `PantallaEmparejar` (cámara embebida, código de 6
  celdas, direcciones, errores, acceso perdido); `ContenidoOtroServidor`; `ContenidoAyuda` (con las filas de gestos
  nativos); fila propia «Este iPhone» y «Olvidar este iPhone» (a6 §8.10.2-§8.10.3); QR para emparejar otro aparato
  (`QRPalco`, `CIQRCodeGenerator`, píxeles nítidos).
- **Textos adaptados de la nota de direcciones** (no hay sección Servidor a la que remitir):
  - solo casa: «…fuera de ella no llegará. Para usarlo también fuera, crea el código desde la web abierta por Tailscale.»
  - loopback: «La dirección {x} solo existe en este aparato: otro iPhone no llegará. Crea el código desde la web del
    Umbrel (por ejemplo, http://umbrel.local:7792).»
- **Pruebas unitarias**: vectores de `directories/model.ts`, `where-playing/model.ts`, `health/model.ts`,
  `devices/model.ts`; `ModeloEmparejarTests` (estados de cámara, canje automático, pausa de 60 s tras 5 fallos),
  `ModeloEmparejarDispositivoTests` (idle → code → paired/expired/error con `devices.changed`), `QRPalcoTests`.
- **UITests**: `FlujoEmparejarUITests` (código demo 482913; código malo → error y háptica; `aceneo://pair` con la app
  emparejada → hoja), `FlujoAjustesUITests` (chips; tema; transparencia; olvidar este iPhone con segundo toque →
  Emparejar sin aviso; revocar otro).
- **Hecho cuando**: `ajustes*`, `dispositivos`, `salud`, `ayuda` y `sistema` pasan la comparación; Emparejar tiene su
  captura propia aprobada por Isma (no hay referencia web).

### 3.9 M8 · Servidor 0.8.1

- **Carpetas**: `ace-player-neo/packages/shared/**`, `ace-player-neo/apps/server/**`, `ace-player-neo/docs/**`,
  `ace-player-neo/package.json` (versión), `ismaeloul-ace-player-neo/CHANGELOG.md`. **Nunca** `releases/` ni el paquete
  de la tienda.
- **Especificación**: a9 entero (healthLive se queda `web`, §0.0 punto 2).
- **Punto de partida**: el commit `e1e5767` de `rediseno/palco` ya abre `health`, `settingsUpdate`, `pairingCreate` (con
  `alternateBaseUrls`, una `u=` por dirección, tope de 5 códigos por minuto por iPhone), `devicesList` y `deviceRevoke`, y
  manda `devices.changed` a todos (tests: contrato 68, servidor 1421, web 767). **Falta solo**: las versiones a 0.8.1
  (`package.json` de la raíz, `apps/server`, `apps/web`, `packages/shared`), la entrada 0.8.1 de `CHANGELOG.md`, la
  release y `docs/ios.md` al día. Lo hace el integrador al final. `MARKETING_VERSION` de la app lo sube I0.
- **Pruebas**: `corepack pnpm@10.18.2 -r test` y `corepack pnpm@10.18.2 -r typecheck` en el PC (memoria: el test
  intermitente se repite una vez antes de darlo por roto); `pnpm lint` con el ignore de la memoria.
- **Hecho cuando**: todo verde en el PC; la app 0.8.1 contra la pila E2E de la CI puede leer salud, dispositivos y
  «Un solo dispositivo a la vez», crear un código y revocar. Commit con la identidad de Isma; **sin push** hasta que él
  lo diga.

---

## 4. Orden de trabajo

### 4.0 Las tres fases de un vistazo

| Fase | Quién | Qué | Sale cuando |
|---|---|---|---|
| 0.1 | I0 | proyecto iOS 26, `Package.swift`, CI nueva, linter, generadores, canarios de API | `solo_compilar`, `generadores` y `nucleo-linux` en verde con la interfaz vieja todavía dentro |
| 0.2 | I0 | poda: rescatar, borrar, mover pruebas | compila con una `RaizView` provisional; las pruebas movidas pasan |
| 0.3a | I0 | tipos puros de §2.1 | compila; Linux verde |
| 0.3b | I0 | resto de contratos y esqueletos (§2.3-§2.8), cableado, argumentos | la app arranca en demo con las 4 pestañas en stub |
| 0.4 | P (tras 0.3a) | Palco entero + laboratorio | banco capturado y comparado; canarios de P cerrados |
| 1 | M1-M8 en paralelo | cada módulo en su carpeta | su «Hecho cuando» de §3 |
| 2 | I1 → I2 | integración, E2E, IPA; calco y calibración | 22 vistas + emparejar comparadas; IPA 0.8.1 probada por Isma |

Ramas: `rediseno/nativa` sale de `rediseno/palco`; cada agente trabaja en `nativa/<módulo>` y se fusiona en
`rediseno/nativa` con `--no-ff`. **Ningún push ni lanzamiento de CI sin que Isma lo pida** (memoria); los agentes dejan
los commits hechos y dicen qué comando de CI lanzarían.

### 4.1 Fase 0 · cimientos (I0) y Palco (P)

#### 4.1.1 Paso 0.1 — proyecto, CI, linter, espejo Linux y canarios (I0)

1. `project.yml` de §1.13.1, `Info.plist` y `xcconfig` de §1.13.3. La interfaz vieja sigue: sus `#available` sobrantes dan
   avisos, no errores.
2. `Package.swift` de §1.13.2 apuntando a lo [L] **que ya existe** (Models, Dominio, Endpoint, APIError, ErrorCatalog,
   SSEParser, Servidores, MaquinaConexion, Directo) + `Puros/Soporte/Fixtures.swift` + `VectoresDominioTests` movido.
   `probar-linux.ps1` verde en el PC.
3. Workflow de §4.4 (trabajos `generadores` y `nucleo-linux` antes del de macOS, entradas nuevas, `solo_compilar` en
   Debug de simulador + Release de dispositivo, alarma de «type-check»).
4. `scripts/revisar-swift.mjs` con las reglas de §5.2 (de momento solo mira carpetas nuevas: `Palco`, `Armazon`,
   `Pantallas`, `Core/Datos`, `Core/Reglas`).
5. Generadores `generar-tokens.mjs`, `generar-iconos.mjs`, `generar-fuentes.py`, `generar-plazos.mjs`, `generar-rutas.mjs`
   con su `--check` en la CI.
6. **Canarios** (`Sources/Sonda/*.swift`, §5.3): un fichero por API de iOS 26 que el diseño da por hecha, compilado en
   Debug y en Release. Si uno falla, se aplica su plan B **antes** de escribir los contratos.

#### 4.1.2 Paso 0.2 — poda (I0, un solo agente, un solo commit)

1. Rescatar lo de §1.11 a su sitio nuevo **sin cambiar comportamiento** (solo nombres y dependencias):
   - `EstadoSenal` viejo (`ok/floja/sinSenal/comprobando/pendiente`, en `Design/Componentes.swift`) → el nuevo de §2.1.3
     (`ok/weak/fail/checking/pending`); se renombran sus usos en `ReglasFuentes`.
   - `CanalReproducible`, `ContextoPartido`, `OrigenReproduccion`, `MotivoParada`, `FalloFuente`, `IntentoReconexion` →
     `Player/TiposReproduccion.swift`.
   - `Reproductor` pierde la presentación (§2.6); `PrioridadHueco` pasa a `mini/teatro/inmersivo/vuelo`.
   - `CentroPartidoModelo` → `SesionFuentes` con `unowned let app` sustituido por `EntornoSesionFuentes` (el port completo
     de `session.ts` es de M3).
2. Borrar la lista de §1.11 y los colorsets. Mover las pruebas según la tabla de §1.11.
3. `RaizView` provisional (texto «Ace Neo» sobre `Bg`) para que el objetivo compile.
4. Salida: `solo_compilar` verde; unitarios verdes (los que quedan); Linux verde.

**Resultado (I0, 25-sep-2026, commits 3c63d0b · 0aa3630 · aecd3ea en `rediseno/nativa`)**: `solo_compilar`
36169850904 verde (sin avisos de tipado), `solo_unitarios` 36170273367 verde (173 pruebas, 0 fallos; antes 198: se
fueron las de código borrado), Linux verde (45 XCTest + 5 Swift Testing). Lo que la fase 0.3b debe saber:

- **Provisionales que 0.3b sustituye**: `App/AppDelegate.swift` y `App/SceneDelegate.swift` mínimos (audio y ventana
  con `UIHostingController(rootView: RaizView())`), `App/RaizView.swift` («Ace Neo» sobre `Palco.bg`),
  `Armazon/Avisos.swift` (el `Avisos` viejo sin vista: `mostrar(_:tono:)`), `Core/Datos/SesionApp.swift` (solo
  `fase` inicial, `enlacePendiente`, `enlaceParaEmparejar` y `abrir(enlace:)`, con `FaseSesion` y `MotivoEmparejar`
  del contrato) y `EntornoSesionFuentes` con solo `api`, `reproductor` y `avisos`.
- **La escena la declara Info.plist** (§1.13.3 y §2.3 corregidos): `SceneDelegate.self` en `configurationForConnecting`
  tardaba ~300 ms en tiparse.
- `SesionFuentes` es el `CentroPartidoModelo` de siempre (`init(partido:entorno:)`, un objeto por partido, entorno
  `unowned`); `HermanasModelo` vive en el mismo fichero. El contrato de §2.6 (una sesión, `conectar(_:)`) es de M3.
- Lo puro rescatado ya no tiene `public` (R13) ni `Date.now` por defecto (R14): quien llama pasa `ahora:`.
  `ReglasAgenda.minutosPrecalentado = 45` sustituye a `ReglasSenal.minutosPrecalentado`; `ReglasAgenda.diaInicial`
  sale del `AgendaViewModel` borrado; el chip de fecha y hora se fue con `ChipHoraTests`.
- `EscanerQR` sin háptica (R8): la pone M7 con `Haptica`. `BotonAirPlay` pinta con `Palco.accent` (el colorset
  «Accent» ya no existe). `Flujo` lleva la firma del contrato pero solo coloca a la izquierda (P completa).
- Linter con alcance «todo» (0 incumplimientos) y la alarma de tipado de la CI ya no ignora ninguna carpeta.
- Pendiente de otros: `generar-recursos.mjs` aún escribe los colorsets y la Marca clara (P);
  `ServidorRealUITests` (I1) y `README.md` (I1) siguen hablando de la interfaz vieja.

#### 4.1.3 Paso 0.3 — contratos y esqueletos (I0)

- **0.3a**: `Core/Reglas` de §2.1 (Destino, Maquetacion, EstadoSenal, TiposAviso, TipoHaptico, OpcionMenu, NombreIcono
  generado, Datos). Commit propio: P arranca desde aquí.
  **Resultado (I0, 25-sep-2026, commit e46c19b en `rediseno/nativa`)**: firmas exactas de §2.1.1-§2.1.4. Cuerpos
  escritos donde el contrato da la fórmula: `Destino.init?(vista:)` con las reglas de `parseVista` (routes.ts: recorta
  espacios y barras, cabeza sin mayúsculas, vacío = agenda, `HASH_RE` en minúsculas, `SEGMENT_RE`; donde la web cae en
  la agenda devuelve `nil`; pestaña de Canales o sección de Ajustes desconocidas → `nil` dentro del caso) y todas las
  fórmulas de `Maquetacion` (mini de 74 de alto; toasts móvil `min(420, ancho − 24 − zonas)`, tableta
  `min(420, ancho − 40)`). **Esqueleto** para M1: `EfectosEvento.de(_:)` y `rutas(de:)` devuelven vacío. `RGB`,
  `ColaToasts`, `LineaEstado` y `Deslizamiento` siguen siendo de M2. Pruebas nuevas en Swift Testing:
  `Puros/Armazon/{DestinoTests,MaquetacionTests}`, `Puros/Comunes/TiposComunesTests` (señal, avisos, menú y
  `ReglaHapticaTests`) y `Puros/Nucleo/DatosPurosTests` (esperas, identidad, capacidades, relojes; M1 las reparte).
  Linux: 45 XCTest + 35 Swift Testing; `solo_compilar` 36171897600 verde; `solo_unitarios` 36172388405 verde
  (203 pruebas, 244 ejecuciones con argumentos, 0 fallos).
- **0.3b**: §2.3-§2.8 con stubs: ciclo de vida UIKit, `ContenedorApp` con el cableado de §2.5.7, `Navegador`, hojas, menús,
  avisos, transición, datos, sesión, reproducción, `IDUI`, las pantallas de §2.8 (cada una `Color.clear` con su
  `IDUI`), `ModoEjecucion` con los argumentos de §3.3.1, `ServidorDemo` provisional que delega en el `ServidorSimulado`
  rescatado hasta que M2 lo sustituya.
- Salida: la app arranca con `-AceNeoDemo` en la agenda (stub) y la barra de pestañas provisional cambia de pestaña;
  `FlujoArmazonUITests.testArrancaYCambiaDePestana` en verde. Se etiqueta `fase0` y se crean las ramas de la fase 1.

**Resultado de 0.3b (I0, 25-sep-2026, commits 0f75e6e · fea7f51 · e27f47d · 4b878e1 · 4c22cce en `rediseno/nativa`,
etiqueta `fase0-contratos`)**: `solo_uitests=FlujoArmazonUITests` 36176979612 verde (la app arranca con `-AceNeoDemo`
en la agenda y la barra cambia a Canales, Buscar, Ajustes y vuelve); `solo_unitarios` 36178928803 verde (203 pruebas,
0 fallos); `solo_compilar` 36179822542 verde en 4c22cce; Linux verde. `ContenedorApp.init` rozó el límite de tipado
(453 ms en 36177994191, por debajo en otra ejecución): tipos escritos y dos ayudantes. Lo que la fase 1 debe saber:

- **Firmas exactas de §2.3-§2.8**. Cuerpos: donde era barato y sin duda, de verdad (`Navegador`, `CentroHojas`,
  `Avisos` con relojes, `CicloVida`, `PreferenciasLocales`, `MigracionClaves` con el código de a1 §13.10, `Consulta`
  sin reintentos, `DatosApp` con las rutas que ya tiene `API`); el resto, valor neutro. Las piezas de §2.5.5 ya van
  cada una en su fichero de §1.4. `ColaToasts` y `LineaEstado` (M2) existen con la firma del contrato y un cuerpo
  sencillo porque `Avisos` los necesita; M2 los calca de notices.
- **`App/PalcoProvisional.swift`**: lo mínimo de Palco (§2.2.3 `Mona.fuente`, §2.2.7 háptica y `HapticaRaiz`, §2.2.10
  los `@Entry`, `TamanoHoja`, `SistemaView` en stub) para no tocar `Sources/Palco`. **Al fusionar `nativa/palco` se
  borra entero** (si no, «invalid redeclaration»), y con él su excepción de R5 en `revisar-swift.mjs`.
- **`SesionFuentes` es ya el contrato de §2.6** (una sesión, `conectar(_:)`, cuerpos neutros; `alFallarFuente` devuelve
  `false`). Lo rescatado en 0.2 se llama ahora **`SesionFuentesPartido`** (misma carpeta, con `SesionFuentesTests`):
  referencia para M3, que lo borra al portar session.ts. `EntornoSesionFuentes` tiene los ocho miembros del contrato.
- **`AppShell` provisional** pinta solo la pestaña actual y una barra de texto (`IDUI.pestana`), con `.hojasDeLaApp`.
  Con las visitadas vivas y ocultas con `.opacity(0)` + `.accessibilityHidden(true)`, XCUITest **seguía viendo** la
  oculta (36175911002): M4 debe sacarla del árbol de otra forma o ajustar la prueba.
- `IDUI` añade `armazon`, `pantalla(_:)`, `hojaGuardarFavorito`, `hojaRenombrar` y `hojaAyuda` (§2.7). Las pantallas
  de §2.8 son `Color.clear` con un `Text` del título encima y `.accessibilityElement(children: .combine)` (un
  `Color.clear` solo no llega con seguridad al árbol de accesibilidad).
- `SettingsUpdateBody` y `PairingCreateBody` (M1) existen con los campos de packages/shared para que `DatosApp`
  compile. `ServidorSimulado.entorno(emparejado:)`: `-AceNeoEmparejado` desaparece; con `-AceNeoDemo` o
  `-AceNeoServidorSimulado` la app arranca emparejada salvo `-AceNeoSinEmparejar`. En demo el motor es `MotorSimulado`.
- CI: entrada nueva **`solo_uitests`** (§4.4). `tocarPestana(app, id)` de `AyudasUI` va por `IDUI.pestana`.
- Sin hacer (de sus dueños): PiP (`GestorPiP`) sin conectar en `ContenedorApp` (M3); oyente de `CicloVida` del
  reproductor (M3); `RGB` (M2) sigue sin existir y `DatosEquipo`/`RGB.color` de P lo necesitan.

#### 4.1.4 Paso 0.4 — Palco y laboratorio (P, en paralelo con 0.3b)

`LaboratorioView` (una página desplazable, Debug) con, en claro y en oscuro:

1. **Fuentes**: «Agenda» 30/800/125 y 44; cuerpo 15/450 en tres líneas (alto de línea 21,75); cápsula 13/640/88;
   `Num` «90+4'» a 64 y «21:00» a 17; Martian «b71e44d0…0c9f2a31 · 1,92 MB/s». Al lado, la misma frase de la captura web.
2. **Iconos**: rejilla de los 52 a 20 y 24, trazo y relleno.
3. **Cristal**: barra de pestañas con píldora, cápsula, botón de vídeo, sobre el héroe demo y sobre `bg`; con
   `cristalOpaco` a los dos valores.
4. **Hoja** con detent medido, **menú contextual** con vista previa, **Menu** con `.menuOrder(.fixed)`.
5. **Barra de estado**: interruptor claro/oscuro sobre un héroe; `subeConLaBarraDeEstado` en una lista larga.
6. **Háptica** con una hoja abierta y en horizontal.

`LaboratorioUITests` captura el banco; I0/P lo comparan con recortes de `final/` (la galería `sistema` de la web tiene
casi todas las piezas). Lo que no case se ajusta aquí, en Palco, **antes** de la fase 1.

#### 4.1.5 Salida de la fase 0 (todas)

- `solo_compilar` verde (Debug simulador y Release dispositivo) sin avisos de `type-check` > 200 ms.
- `generadores` y `nucleo-linux` verdes (linter y todos los `--check`).
- Canarios cerrados (cada uno «vale» o «plan B aplicado») y sus ficheros borrados.
- Laboratorio aprobado: fuente, alto de línea, iconos y `Num` a ±1 pt de la web; cristal aceptable en los dos temas.
- `rediseno/nativa` etiquetada `fase0`.

### 4.2 Fase 1 · módulos en paralelo

- Cada agente parte de `fase0`, trabaja en `nativa/<módulo>` y **solo** en sus carpetas (§3).
- Ciclo corto: escribir → `revisar-swift.mjs` → `probar-linux.ps1` (si tocó [L]) → commit → pedir `solo_compilar` en su
  rama. Ciclo largo (cuando compila): CI con `solo_unitarios`; al final, la CI completa de su rama con `capturas: clave`.
- Orden de fusión en `rediseno/nativa`: **M1, M2, M3** (sin pantallas) → **M4** → **M5, M6, M7** (en el orden en que
  terminen). **M8** en cualquier momento (no toca `apps/ios`). Tras cada fusión, los demás hacen `git rebase
  rediseno/nativa`; como nadie comparte carpetas, solo puede chocar un contrato, y eso lo resuelve el integrador.
- Si un módulo necesita algo de otro que aún es stub, lo prueba con la demo y deja una línea en su informe; **no** lo
  escribe él.
- La cuenta gratuita deja **5 trabajos de macOS a la vez**: como mucho 5 ramas con la CI en marcha; el resto espera
  (`concurrency` por rama ya cancela las viejas de la misma rama).

### 4.3 Fase 2 · integración (I1) y calco (I2)

**I1** (un agente):

1. Fusiona lo que falte, quita los stubs muertos y corre la CI completa en `rediseno/nativa`: unitarios sin reintento,
   UITests con reintento 2, E2E contra la pila (`ServidorRealUITests`: emparejar con código real, agenda, reproducir un
   canal del motor falso, salud, dispositivos, «Olvidar este iPhone»).
2. Arregla solo lo de integración (cableado, orden de arranque, carreras); lo de un módulo lo devuelve a su dueño.
3. Documentación: `docs/ios.md`, `docs/pruebas-iphone.md`, `apps/ios/README.md`.
4. IPA 0.8.1 sin firmar (artefacto de la CI) para que Isma la instale.

**I2** (un agente, cuando I1 está en verde):

1. `EscenasCaptura` para las 22 vistas de `final/` y Emparejar: cada escena deja la app en ese estado con
   `-AceNeoDemo -AceNeoReloj 2026-09-24T19:00:00+02:00 -AceNeoEscena <vista>` sin pasos de interfaz.
2. `CapturasPalcoUITests` en el iPhone 16e (390×844, zonas 47/34, @3x) con la barra de estado fijada (`simctl status_bar
   override --time 9:41 --batteryLevel 100 --cellularBars 4 --wifiBars 3`): 390×844 claro, oscuro, claro con transparencia
   reducida y oscuro con movimiento reducido; 844×390 oscuro. Nombres idénticos a `final/`
   (`<vista>-390x844-claro.png`…) en `capturas/_revision/ios-nativa/<vista>/`.
3. Referencias web recapturadas por M2 en `web-palco/calco/` con el mismo reloj, @3x y las zonas seguras inyectadas.
4. `comparar-capturas.py`: tapa la barra de estado (arriba, 47 pt) y el indicador de inicio (abajo, 34 pt); compara
   **estricto** con transparencia reducida (≤ 0,5 % de píxeles con diferencia > 8/255) y **tolerante** en las zonas de
   cristal (máscaras por vista, revisión a ojo); informe HTML con las tres imágenes (web, app, diferencia) por vista.
5. Calibra en un solo sitio cada cosa: tinte (`CristalPalco.vidrio`), alto de línea (`altoDeLinea`), sombras
   (`SombraPalco`). Lo demás que no case vuelve a su módulo con la captura.

**Salida del proyecto**: las 22 vistas pasan; Emparejar aprobada por Isma; IPA 0.8.1 probada en el iPhone de Isma con
su servidor 0.8.1 (casa y Tailscale, PiP, AirPlay, pantalla de bloqueo, segundo plano).

### 4.4 CI (`.github/workflows/ios.yml`, solo I0 lo toca)

```yaml
on:
  workflow_dispatch:
    inputs:
      solo_compilar:   { type: boolean, default: false, description: 'Debug simulador + Release dispositivo; nada más' }
      solo_unitarios:  { type: boolean, default: false, description: 'Compilar + tests unitarios (sin UITests ni pila E2E)' }
      ipa_sin_tests:   { type: boolean, default: false, description: 'Compilar y sacar la IPA sin pasar pruebas' }
      ipa_aunque_fallen_tests: { type: boolean, default: false }
      capturas:        { type: choice, options: [ninguna, clave, completas], default: ninguna }
      simulador:       { type: string, default: 'iPhone 16e' }
      solo_uitests:    { type: string, default: '' }   # (0.3b) p. ej. FlujoArmazonUITests,LaboratorioUITests/testHapticaConHoja (comas, fase 0): solo esos UITests, sin unitarios, pila E2E ni IPA
  # push y pull_request: como hoy (rewrite-v2, main, tags ios-v*)

jobs:
  generadores:                       # segundos: linter y --check (Node); si falla, no se gasta macOS
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: ace-player-neo } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: corepack enable && corepack pnpm@10.18.2 install --frozen-lockfile
      - run: node apps/ios/scripts/revisar-swift.mjs
      - run: |
          node apps/ios/scripts/generar-tokens.mjs --check
          node apps/ios/scripts/generar-iconos.mjs --check
          node apps/ios/scripts/generar-plazos.mjs --check
          node apps/ios/scripts/generar-rutas.mjs --check
          node apps/ios/scripts/generar-catalogo-errores.mjs --check
          corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-vectores.ts --check
          corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-demo.ts --check
          pip install -q fonttools brotli && python3 apps/ios/scripts/generar-fuentes.py --check

  nucleo-linux:                      # minutos: el núcleo puro con Swift 6.2 (sin Node: la imagen no trae Python ni g++ de sobra)
    runs-on: ubuntu-latest
    container: swift:6.2-noble
    steps:
      - uses: actions/checkout@v4
      - run: apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tzdata
      - run: swift test
        working-directory: ace-player-neo/apps/ios

  ios:
    needs: [generadores, nucleo-linux]
    runs-on: macos-latest            # Xcode 26.6, SDK iOS 26.5
    timeout-minutes: 90
    steps:
      # … Xcode más reciente, XcodeGen, pnpm, xcodegen generate (como hoy)
      - name: Solo compilar
        if: inputs.solo_compilar
        run: |
          set -o pipefail
          xcodebuild build -project AceNeo.xcodeproj -scheme AceNeo -configuration Debug \
            -destination "platform=iOS Simulator,name=${{ inputs.simulador }}" | tee compilar.log
          xcodebuild build -project AceNeo.xcodeproj -scheme AceNeo -configuration Release \
            -destination "generic/platform=iOS" CODE_SIGNING_ALLOWED=NO | tee -a compilar.log
          if grep -n "to type-check" compilar.log; then echo "::error::expresión o función lenta de tipar"; exit 1; fi
      # resto: build-for-testing, pila E2E (si no es solo_unitarios), tests unitarios SIN reintento,
      # UITests con -retry-tests-on-failure -test-iterations 3, status_bar override antes de las capturas,
      # capturas según `capturas` (clave = agenda, partido, mini-reproductor, biblioteca-favoritos, ajustes, emparejar;
      # los dos temas), artefactos con nombres de final/, IPA como hoy.
```

`solo_compilar` tarda unos minutos y es lo que los agentes piden una y otra vez. La CI completa solo cuando compila.

### 4.5 Comandos en el PC de Isma (Windows)

| Para | Comando (desde `ace-player-neo/`) |
|---|---|
| Núcleo puro en Linux | `pwsh apps/ios/scripts/probar-linux.ps1` (Docker Desktop) |
| Linter | `node apps/ios/scripts/revisar-swift.mjs` |
| Generadores | `node apps/ios/scripts/generar-<x>.mjs [--check]` · `corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-vectores.ts [--check]` |
| Fuentes (en el PC no hay Python) | `docker run --rm -v "${PWD}:/w" -w /w python:3.12-slim sh -c "pip install -q fonttools brotli && python apps/ios/scripts/generar-fuentes.py"` |
| Servidor y web | `corepack pnpm@10.18.2 -r test` · `corepack pnpm@10.18.2 -r typecheck` |
| CI (solo si Isma lo pide) | `gh workflow run ios.yml --ref nativa/<módulo> -f solo_compilar=true` · `gh run watch` · `gh run download <id>` |
| Commit | `git -c user.name="Isma" -c user.email="ismaeloulhaji@gmail.com" commit` con la línea `Co-Authored-By` |

---

## 5. Reglas de estilo y de compilación segura

### 5.1 Reglas de trabajo (cortas y sin excepciones)

1. **Tu carpeta o nada.** Lo de otro se usa por su contrato. Si un contrato no alcanza, se para y se pide al integrador
   con la firma propuesta; el integrador la cambia en la rama base y todos rebasan.
2. **Textos de la web, literales.** Ni uno inventado; si falta, se busca en `apps/web/src` y se cita el fichero.
   `Redaccion` (M2) pasa las reglas de `wording.test.ts` a todos los catálogos.
3. **Cada número con su fuente**: toda medida, tiempo o umbral lleva al lado `// a4 §5.2` (o el fichero de la web).
4. **Lo que decide es puro** (`Core/Reglas`, con prueba); la vista solo pinta y llama.
5. **Una `View` por fichero; `body` de 40 líneas como mucho**; lo demás en `private var` o `private struct`.
6. **Tipos explícitos en la frontera `CGFloat`/`Double`**: nada de expresiones que mezclen los dos con más de dos
   operadores; se convierte antes en una `let`. Nada de `ForEach` sobre rangos calculados en línea ni cierres de más de
   una expresión dentro de modificadores encadenados.
7. **Tiempo solo por `Reloj`** (nada de `Date()` en reglas ni vistas); **preferencias solo por `PreferenciasLocales`**.
8. **Sin estado global**: todo objeto de proceso vive en `ContenedorApp`; nada de `static var` mutables fuera de él.
9. **Commits pequeños que compilan solos**, en español, `tipo(ios-<módulo>): …`, con
   `git -c user.name="Isma" -c user.email="ismaeloulhaji@gmail.com" commit` y la línea
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Sin push ni CI** hasta que Isma lo diga.
10. **Informe al acabar** (texto, no fichero): qué hizo, qué stubs de otros usó, qué comando de CI lanzaría y qué
    capturas quedan por comparar.

### 5.2 Linter `scripts/revisar-swift.mjs`

Recorre `Sources/**/*.swift` (salvo `*.generado.swift`) y sale con código 1 si algo no cumple. Hasta la poda (0.2)
mira solo las carpetas nuevas; desde la poda, todo `Sources` («todo» en la tabla). Una línea que termine en
`// permitido: <motivo>` se salta **solo** para las reglas marcadas «con permiso» (el integrador revisa cada una).
`Sources/Sonda/**` quedaba fuera del linter; se borró al cerrar la fase 0 y el linter ya no lo menciona.

| # | Regla | Patrón (regex) | Dónde | Excepción |
|---|---|---|---|---|
| R1 | sin navegación del sistema | `\b(NavigationStack\|NavigationView\|NavigationLink\|TabView)\b` | todo | — |
| R2 | sin ramas de versión | `#available\|#unavailable\|@available\(iOS` | todo | `@available(*, unavailable)` |
| R3 | sin `GeometryReader` | `GeometryReader` | todo | — |
| R4 | sin `AnyView` | `\bAnyView\b` | todo | `Palco/Componentes/ImagenServidor.swift` |
| R5 | una sola puerta | `\.glassEffect\(` · `\.sensoryFeedback\(` · `\.sheet\(` · `\.contextMenu\(` · `VistaVideo\(` | todo | `Palco/Cristal/Cristal.swift` (+ `Galeria/LaboratorioView.swift`) · `Palco/Haptica/HapticaRaiz.swift` · `Armazon/Hojas.swift` · `Armazon/Menus.swift` · `Pantallas/Partido/EscenarioVideo.swift`, `Pantallas/Mini/MiniReproductor.swift`, `Armazon/VueloVideo.swift` (y su definición en `Player/SuperficieVideo.swift`) |
| R6 | colores solo de Palco | `Color\((red\|\.sRGB\|hex)\|UIColor\((red\|hex)\|#colorLiteral\|0x[0-9A-Fa-f]{6}\b` | todo | `Palco/Tokens/**` |
| R7 | fuentes solo de Mona | `Font\.system\|\.font\(\.system\|Font\.custom\|UIFont\.systemFont\|UIFont\(name` | todo | `Palco/Tipografia/**` |
| R8 | háptica solo por `Haptica` | `UI(Impact\|Selection\|Notification)FeedbackGenerator` | todo | — |
| R9 | identificadores solo de `IDUI` | `accessibilityIdentifier\("` | todo | — |
| R10 | concurrencia (con permiso) | `nonisolated\(unsafe\)\|@unchecked Sendable\|Task\.detached\|DispatchQueue\|MainActor\.assumeIsolated` | carpetas nuevas | `// permitido:` |
| R11 | observación moderna | `ObservableObject\|@Published\|@StateObject\|@ObservedObject\|@EnvironmentObject` | todo | — |
| R12 | lo puro es puro | `^import (SwiftUI\|UIKit\|os\|Observation\|AVFoundation\|AVKit\|CoreGraphics)` y `\bCGFloat\b` | `Core/Reglas`, `Core/Models`, `Core/Dominio`, `Debug/DemoNucleo`, `Player/{MaquinaConexion,Directo,TiposReproduccion}.swift`, `App/MigracionClaves.swift` | — |
| R13 | nada `public` nuevo | `^\s*(public\|open) ` | `Palco`, `Armazon`, `Pantallas`, `Core/Datos`, `Core/Reglas`, `Core/Emparejar` | — |
| R14 | reloj inyectado | `Date\(\)\|Date\.now\|\.now\b` | `Core/Reglas`, `Pantallas`, `Armazon` | `Core/Reglas/Datos/Reloj.swift` |
| R15 | sin `print` | `\bprint\(` | todo | `Sources/Debug/**` |
| R16 | animación con valor | `\.animation\([^,()]*\)\s*$` | todo | — |
| R17 | sin temporizadores | `\bTimer\.\|asyncAfter` | todo | — |
| R18 | preferencias en su sitio | `UserDefaults\.standard` | todo | `App/{PreferenciasLocales,MigracionClaves,AppDelegate,Entorno}.swift` |
| R19 | sin pantalla global | `UIScreen\.main` | todo | — |
| R20 | ficheros cortos (aviso) | más de 400 líneas | todo | `*.generado.swift` |

### 5.3 Canarios de la fase 0.1 (`Sources/Sonda`)

Cada canario es un fichero que **usa** la API tal como la usará el contrato. Compilan en Debug y Release; los marcados
«banco» se miran además en el laboratorio (§4.1.4). Se borran al cerrar la fase 0.

| # | API / supuesto | Comprobación | Plan B (sin tocar firmas de §2) |
|---|---|---|---|
| C1 | `glassEffect(_:in:)`, `Glass.regular.tint(_:).interactive()`, `GlassEffectContainer` | compila · banco | se ajusta solo `Cristal.swift` |
| C2 | `Observations { … }` (Swift 6.2, iOS 26) con elemento tupla | compila · banco (la barra cambia) | `withObservationTracking` en bucle en `HostingRaiz` |
| C3 | `UIGestureRecognizerRepresentable` con delegado (ceder al borde y a carriles) | compila · banco | `UIViewRepresentable` transparente que instala el reconocedor |
| C4 | `@Entry` con valores `Maquetacion` y `CacheImagenes?` (actor) | compila | `EnvironmentKey` escrita a mano |
| C5 | `.sensoryFeedback(trigger:_:)` con cierre que devuelve `SensoryFeedback?` | compila · banco (con hoja abierta y en horizontal) | ocho `.sensoryFeedback(_:trigger:)` fijos en `HapticaRaiz` |
| C6 | `.presentationDetents([.height(medido)])` + `presentationBackground` + `presentationContentInteraction(.scrolls)` | banco | `.fraction` fija por hoja en `Hoja.detents` |
| C7 | `.contextMenu(menuItems:preview:)` con vista previa propia | banco | `.contextMenu(_:)` sin vista previa |
| C8 | `scrollPosition(_:)` con `ScrollPosition`, `onScrollGeometryChange(for:of:action:)` | compila | `ScrollViewReader` + `onGeometryChange` |
| C9 | `.contentTransition(.numericText(value:))` dentro de una celda de ancho fijo | banco | sin rueda (como la web) |
| C10 | CTFont variable con `wdth` + `wght` desde un TTF de `UIAppFonts` | banco + `FuentesTests` (avance del «4») | instancias estáticas por (peso, anchura) usadas, generadas por `generar-fuentes.py` |
| C11 | Swift Testing + `Bundle.module` en `swift test` de Linux | trabajo `nucleo-linux` | XCTest en `Puros/` |
| C12 | `platforms: [.iOS(.v26), .macOS(.v26)]` en PackageDescription 6.2 | trabajo `nucleo-linux` | quitar `platforms` |
| C13 | overrides de barra de estado e indicador en `HostingRaiz` con raíz SwiftUI | banco | `.statusBarHidden` + `.preferredColorScheme` por zona (se pierde el matiz por zona) |
| C14 | `ImageRenderer` → `UIImage` plantilla dentro de `Label` de `Menu` | banco | `UIGraphicsImageRenderer` dibujando el `Path` |
| C15 | `onGeometryChange(for:of:action:)` en `.global` durante un `ScrollView` (marcos del vuelo) | banco | coordenadas con nombre del `AppShell` |

#### 5.3.1 Resultado real de los canarios (I0, fase 0.1, 25-sep-2026)

Compilados en la CI con Xcode 26.6 (Swift 6.2, macOS 26.6.2), simulador iPhone 16e con iOS 26.2, Debug de simulador
(`build-for-testing`) y Release de dispositivo (`solo_compilar`: ejecuciones 36163818991 y 36166522134, en verde) y
unitarios en el simulador (`solo_unitarios`: 36165365851, 198 pruebas, 0 fallos). Linux: `swift:6.2-noble` en Docker
(`probar-linux.ps1`) y trabajo `nucleo-linux`. Informe completo: `c0-canarios.md` de esta carpeta. «Banco pendiente» = la
parte que solo se ve en pantalla la mira P en el laboratorio (§4.1.4); la API **existe con esa firma y compila**.

| # | Resultado | Qué se comprobó | Qué cambia |
|---|---|---|---|
| C1 | **vale** (ajuste de tinte en claro: `CristalPalco.velo`) | `glassEffect(_:in:)` con `Glass` devuelto por una función, `.regular.tint(_:)`, `.interactive()`, `GlassEffectContainer(spacing:)`, modificador genérico sobre `Shape` con `some Shape = Capsule()` | nada |
| C2 | **vale con un ajuste** | `Observations` con la tupla de cinco de §2.3 compila **solo si el cierre NO se anota `@MainActor in`** (hereda el aislamiento de la `Task { @MainActor … }`). Con `Observations { @MainActor in … }` el compilador **se cae** en IRGen (tupla: 36162945144; struct: 36163440026). Sin anotar: 36164502581 y verde en la rama | §2.3 corregido: `Observations { (…) }` sin `@MainActor in`. El plan B (`withObservationTracking` en bucle) también compila y queda de reserva |
| C3 | **vale** | `UIGestureRecognizerRepresentable` con `makeCoordinator(converter:)`, coordinador `UIGestureRecognizerDelegate` (`shouldBeRequiredToFailBy` con `UIScreenEdgePanGestureRecognizer`, simultáneo), `update…`, `handle…Action` y `.gesture(_:)` sobre un `ScrollView` | nada |
| C4 | **vale** | `@Entry` con un struct puro, `Bool`, `CGFloat` y un **actor** opcional (`= nil`) | nada |
| C5 | **vale** (la vibración se siente en el iPhone) | `.sensoryFeedback(trigger:_:)` con cierre `{ _, nuevo in nuevo.tipo.feedback }` (devuelve `SensoryFeedback`, no opcional) y la tabla de `TipoHaptico.feedback` | nada |
| C6 | **vale** | `.sheet(item:onDismiss:)` con `@Bindable`, `onGeometryChange(for: CGFloat.self)`, `.presentationDetents([.height(medido)])`, `.large`, `[.medium, .large]`, `presentationDragIndicator`, `presentationBackground(Color)`, `presentationCornerRadius`, `presentationContentInteraction(.scrolls)` | nada |
| C7 | **vale** | `.contextMenu { } preview: { }`, `Menu` con `Section`, `Button(role: .destructive)`, `Toggle`, `.menuOrder(.fixed)` y `accessibilityActions { ForEach … }` | nada |
| C8 | **vale** | `ScrollPosition(edge: .top)`, `.scrollPosition($posicion)`, `posicion.scrollTo(edge:)`, `onScrollGeometryChange(for:of:action:)` con `contentOffset` y `contentInsets` | nada |
| C9 | **vale** | `.contentTransition(.numericText(value:))` en celdas de ancho fijo con `.animation(_:value:)` | nada |
| C10 | **vale** | en el simulador (`InfoPlistTests`): los tres TTF están en el bundle y registrados por `UIAppFonts`; `CTFontCopyVariation` devuelve wdth 125 y wght 800; el «4» se estrecha a wdth 75 y se ensancha a 125; la Mona modificada tiene ascendente 88,5, descendente 11,5 e interlineado 0 a 100 pt. Compilan `OSAllocatedUnfairLock<[Clave: Font]>`, `Font(CTFont)` y `UIFont` por descriptor | **nombre de la fuente modificada** (riesgo 8): la OFL de Mona Sans reserva «Mona», así que la versión con métricas cambiadas se llama **«Palco Sans»**: fichero `PalcoSans-Variable.ttf`, PostScript **`PalcoSans-ExtraLight`** (no `MonaSansPalco-…`). §1.2, §1.13.3 y §2.2.3 corregidos |
| C11 | **vale** | Swift Testing (`@Test`, `@Test(arguments:)` con tuplas, `#expect`) y `Bundle.module` con `resources: [.copy("Vectores")]` en `swift test` de Linux; los mismos ficheros en Xcode con `@testable import AceNeo` | `Fixtures.raiz` en SwiftPM sube **7** niveles, no 6 (§1.13.2 corregido) |
| C12 | **vale** | `platforms: [.iOS(.v26), .macOS(.v26)]` con `swift-tools-version: 6.2` | nada |
| C13 | **vale** | `UIHostingController<Raiz>` con `init(…)` propio, `required init?(coder:)` `@available(*, unavailable)` y los cinco overrides + los cuatro `setNeeds…` | nada |
| C14 | **vale** | `ImageRenderer` (`scale = 3`) → `uiImage.withRenderingMode(.alwaysTemplate)` en `Label { } icon: { Image(uiImage:) }` dentro de `Menu` | nada |
| C15 | **vale** | `onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action:` en celdas de un `LazyVStack` dentro de `ScrollView`, con `@ObservationIgnored` en el diccionario de marcos | nada |
| C16 | **vale** (añadido por I0) | `final class …: Sendable` con `let` + `Mutex` (Synchronization) y **sin** `@unchecked`, como `EstadoDemo` (§0.1): compila en iOS (Debug y Release) y en Linux (`swift:6.2-noble`) | nada |

**Cierre de la fase 0 (I0, 25-sep).** Todos los canarios quedan **«vale»** (ninguno con plan B; C2 con el ajuste
de 0.1) y `Sources/Sonda` está borrado. Lo que solo se ve en pantalla se comprobó en el banco con `LaboratorioUITests`
(C2/C13 barra de estado leída de la captura, C5 cuenta de pulsos con hoja y en horizontal, C6/C7 hojas y menú de las
puertas de la app, C15 marco `.global` de `.piezaVuelo` a ±1 pt tras desplazar). C1: en claro, `CristalPalco.vidrio`
no tiñe y `CristalPalco.velo` pone el velo `--glass` de la web encima (`c0-cristal/`); el cristal de vídeo pinta
siempre en oscuro. Detalle y ejecuciones: `c0-canarios.md`, «Cierre de la fase 0».

Otros hallazgos de la fase 0.1 que tocan a todos:

- **XcodeGen `optional: true` no basta** para un fichero que no existe: el objetivo lo sigue esperando y `build-for-testing`
  falla. `Sources/Armazon/IdentificadoresUI.swift` ya existe como esqueleto (`enum IDUI {}`) para que compilen los UITests.
- `solo_compilar` compila el Debug de simulador con `build-for-testing` (la app **y** sus pruebas), no solo la app.
- La alarma de «to type-check» ignora la interfaz vieja hasta la poda (§1.11): hoy avisa en `EscenarioView.swift` (un
  `body` de 24,6 s) y `ReproductorVistas.swift`, que se borran en la fase 0.2.
- `Color(claro:oscuro:…)`, `Color(hex:alfa:)` y `UIColor(hex:alfa:)` (§2.2.1) ya están en `Palco/Tokens/ColorDinamico.swift`
  porque el generado los necesita; `ParteIcono` vive en `TrazosIcono.generado.swift` (lo escribe el generador) y P **no**
  lo vuelve a declarar en `IconoPalco.swift`. La extensión `RGB.color` llega con `RGB` (M2).
- `Endpoint.swift` y `APIError.swift` ya importan `FoundationNetworking` en Linux (lo pedía `nucleo-linux`).

### 5.4 Plantillas seguras

```swift
// Una pantalla: dependencias del entorno, body corto, partes con nombre.
struct TarjetaEjemplo: View {
    let partido: FootballMatch
    @Environment(Navegador.self) private var navegador
    @Environment(Haptica.self) private var haptica
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        VStack(alignment: .leading, spacing: S.s2) {
            cabecera
            pie
        }
        .tarjeta()
        .accessibilityIdentifier(IDUI.tarjetaPartido(partido.id))
    }

    private var cabecera: some View { … }
    private var pie: some View { … }
}
```

```swift
// Datos atados a la vista y a la pestaña visible; trabajo que se cancela solo.
.mira(datos.agenda)
.task(id: dia) { await modelo.cargar(dia: dia) }
```

```swift
// Un plazo dentro de un @Observable (autoocultado, «Deshacer», segundo toque).
@ObservationIgnored private var tarea: Task<Void, Never>?
func programarOcultado() {
    tarea?.cancel()
    tarea = Task { [weak self] in
        try? await Task.sleep(for: .seconds(3.2))            // a4 §5.3
        guard !Task.isCancelled else { return }
        self?.ocultarControles()
    }
}
```

```swift
// Regla pura probada con los vectores del TypeScript real (Swift Testing).
private let casos = try! JSONDecoder().decode([CasoTarjeta].self, from: Vectores.datos("vectores-agenda"))

@Test(arguments: casos)
func lineaDeTarjeta(_ caso: CasoTarjeta) {
    #expect(TarjetasAgenda.linea(caso.entrada, ahora: caso.ahora) == caso.salida)
}
```

---

## 6. Riesgos y mitigaciones

| # | Riesgo | Señal temprana | Mitigación | Dueño |
|---|---|---|---|---|
| 1 | Una API de iOS 26 no tiene la firma supuesta | canario rojo en 0.1 | plan B de §5.3 antes de escribir contratos | I0 |
| 2 | Compilar solo en la CI hace lentas las iteraciones | colas de 20 min | `solo_compilar` (minutos); linter y Linux en segundos antes de macOS; ≤ 5 ramas a la vez | todos |
| 3 | El comprobador de tipos se atasca en vistas grandes | aviso «to type-check» | banderas de §1.13.1 + alarma en la CI; §5.1.5-6 | todos |
| 4 | Errores de concurrencia en cascada | un cambio de contrato rompe 3 módulos | aislamiento fijado en §2.0; sin aislamiento por defecto; contratos solo por el integrador | I0/I1 |
| 5 | La poda rompe el núcleo | unitarios rojos tras 0.2 | un agente, un commit, rescate sin cambios de comportamiento, pruebas movidas clase a clase | I0 |
| 6 | Alto de línea distinto de la web | banco: párrafos 1-2 pt más altos o bajos | `MonaSansPalco` + `altoDeLinea`; plan B `TextoMultilinea` (UILabel) solo en párrafos | P |
| 7 | CoreText ignora un eje de la fuente variable | «4» con avance de wdth 100 | canario C10 + `FuentesTests`; plan B instancias estáticas | P |
| 8 | Licencia OFL: nombre reservado en la fuente modificada | `OFL.txt` declara «Reserved Font Name» | P lo mira al generar; si lo hay, la familia modificada se llama «Palco Sans» (solo interno) | P |
| 9 | Liquid Glass no se parece al cristal de la web | comparación tolerante con mucha diferencia | tinte en un solo sitio y calibrado por I2; opaco exacto con transparencia reducida; comparación estricta ahí | P/I2 |
| 10 | Cristal caro en listas largas y sobre vídeo | tirones en el iPhone | `vidrioEnListas = false`; `GlassEffectContainer`; cristal de vídeo solo en controles visibles | P/M6 |
| 11 | La hoja medida salta o recorta | banco C6 | `.fraction` fija por hoja | M4 |
| 12 | Vista previa del menú del vídeo robando la capa de vídeo | el vídeo parpadea al mantener pulsado | la vista previa es `VistaPreviaVideo` (tesela), nunca un `VistaVideo` | M6 |
| 13 | Dos huecos pelean por la `AVPlayerLayer` | vídeo negro al volver | `PrioridadHueco` + `SuperficieYPiPTests`; `VistaVideo` solo en 3 sitios (R5) | M3 |
| 14 | Marcos del vuelo mal medidos (scroll, giro) | escudos que saltan | marcos en `.global` publicados y olvidados por `.piezaVuelo`; plan B sin vuelo del vídeo; reducido = fundido | M4 |
| 15 | Gestos que chocan (borde, vídeo, scroll, carriles) | UITests de teatro inestables | reconocedores UIKit con delegados y bloqueo de eje de 8 pt; umbrales puros de la web | M2/M4/M6 |
| 16 | El doble toque retrasa el toque simple | controles lentos al tocar el vídeo | solo en `CapaToquesVideo`; los botones de los controles no esperan | M6 |
| 17 | SSE en segundo plano y cambios de red | eventos perdidos al volver | `pasoASegundoPlano`, `VigiaRed`, `Last-Event-ID`, `resync` → invalidar todo | M1 |
| 18 | TanStack mal calcado (peticiones de más o de menos) | contador de `MockURLProtocol` | `ConsultaTests` con la tabla de a7 §4 | M1 |
| 19 | Formatos en español distintos de `Intl` | «sept.» frente a «sep» | tablas propias + vectores de `formatWhen` y compañía | M2 |
| 20 | Demo que depende del reloj | golden rojo según la hora | `RelojDesplazado`; golden en T0, T0 + 5 min y T0 + 2 h; web recapturada con el mismo reloj | M2 |
| 21 | Capturas no comparables | diferencias en toda la imagen | @3x en los dos lados, máscaras de barra de estado e indicador, zonas seguras inyectadas en la web | M2/I2 |
| 22 | El servidor de Isma sigue en 0.8.0 | 403 `origin_forbidden` | `Capacidades` + aviso «necesita la 0.8.1» (a9 §9.1); `SesionAppTests` | M1/M7 |
| 23 | `healthLive` era la ruta `web` de ejemplo en tests | tests del servidor rojos | M8 cambia el ejemplo a otra ruta que siga siendo `web` | M8 |
| 24 | Choques entre agentes | conflictos al rebasar | carpetas exclusivas; contratos solo por el integrador; rebase tras cada fusión | I1 |
| 25 | `macos-latest` cambia de Xcode a mitad | avisos nuevos, SDK distinto | el paso «Elegir Xcode» fija 26.6 si existe y avisa si no | I0 |
| 26 | Sin sección «Servidor», cambiar de direcciones | Isma pregunta cómo | emparejar de nuevo por QR o enlace (conserva y sustituye); pregunta A-1 | M7 |
| 27 | Isma no puede probar hasta la fase 2 | — | IPA con `ipa_sin_tests` a petición en cualquier momento desde la fase 1 | I1 |

---

## Anexo A · Preguntas para Isma (no bloquean: se construye lo que dice «Por defecto»)

| # | Pregunta | Por defecto |
|---|---|---|
| A-1 | ¿Quieres la sección «Servidor» de Ajustes (solo app: ver y cambiar las direcciones de casa y Tailscale), aunque la web no la tenga? | **Fuera.** Se cambia de servidor emparejando otra vez; la nota de direcciones de Dispositivos se reescribe sin remitir a ella (§3.8) |
| A-2 | ¿Quieres accesos rápidos al mantener pulsado el icono (Agenda, Buscar, Emparejar)? | **Fuera** (la web en Safari no los tiene) |
| A-3 | En claro, ¿barra de estado blanca solo sobre el héroe y oscura al bajar? (la web la deja siempre blanca, ilegible en claro) | **Sí**: blanca sobre el héroe, la franja del teatro y la cámara; por tema en el resto |
| A-4 | Cuando el servidor se actualiza con la app abierta, ¿se queda el toast de versión nueva (a7 §5.2)? | **Se queda** |
| A-5 | «Pegar del portapapeles»: ¿botón con el aspecto de la web (iOS pide permiso la primera vez) o el `PasteButton` del sistema (sin permiso, pero con su aspecto)? | **Botón de la web** |
| A-6 | «Otras fuentes» (calcado de la web, §0.0 punto 1): ¿ese nombre? ¿Lo quieres también en la web? | **Ese nombre, solo en la app** hasta que digas |
| A-7 | En la hoja de ayuda, ¿añadimos las filas de los gestos nativos (borde, doble toque, deslizar el vídeo, tirar para actualizar, tocar la pestaña activa)? | **Sí**, con el formato de las filas de la web |
| A-8 | En horizontal, las hojas son las nativas del iPhone (la web pinta diálogos centrados): ¿de acuerdo? | **Sí** (consecuencia de la decisión 5); el contenido mantiene los anchos 420/560/760 |
