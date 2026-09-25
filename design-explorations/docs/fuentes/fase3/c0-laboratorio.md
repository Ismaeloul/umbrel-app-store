# C0 · Laboratorio de Palco (fase 0.4, P)

> 25-sep-2026. Paso 0.4 de `b-arquitectura.md` (§3.1, §2.2, §4.1.4). Rama `nativa/palco` (sale de `e46c19b`, fase
> 0.3a). Qué casa con la web, qué no y qué se calibró. Rutas relativas a `ace-player-neo/apps/ios/`.

## 1. Qué hay

| Pieza | Dónde |
|---|---|
| Tokens: colores generados (claro/oscuro, `PalcoMezcla`, `Palco.catalogo`), `Color(claro:oscuro:)`, `RGB.color`, mezcla OKLab provisional | `Sources/Palco/Tokens/{ColoresPalco.generado,ColorDinamico}.swift`; `scripts/generar-tokens.mjs` escribe además `Tests/AceNeoTests/Vectores/vectores-tokens.json` |
| Medidas (`S`, `R`, `Capa`, `Alturas`), muelles (`Movimiento` + `ace-onda` y la curva `--ease-out`), sombras con extensión negativa (`SombraPalco`, `.sombra`, `.bordeInterior`, `.brilloSuperior`, `.franjaIzquierda`) | `Sources/Palco/Tokens/{Medidas,Movimiento,Sombras}.swift` |
| Tipografía: `Mona` (Palco Sans / Mona Sans, dos ejes siempre, caché con candado), `Martian`, `EstiloTexto`, `.estilo()`, `.altoDeLinea()`, `.altoDeLineaMartian()` | `Sources/Palco/Tipografia/` |
| Iconos: los 52 de `ui/icons.ts` (caminos leídos una vez y escalados), `FormaIcono`, `IconoPalco` (trazo y «relleno + trazo»), `IconoImagen` | `Sources/Palco/Iconos/`; `scripts/generar-iconos.mjs` |
| Cristal (`glassEffect` con el tinte del token; sólido exacto con transparencia reducida), háptica (`Haptica`, `HapticaRaiz`), entorno (§2.2.10), gestos (`DeslizamientoHorizontal`, `subeConLaBarraDeEstado`) | `Sources/Palco/{Cristal,Haptica,Entorno,Gestos}/` |
| Las primitivas de §2.2.11 con sus firmas | `Sources/Palco/Componentes/` (una por fichero) |
| Galería «Sistema» (los 16 bloques de a1 §11) | `Sources/Palco/Galeria/Sistema*.swift`, `MuestrasGaleria.swift` y una vista por fichero (cierre de la fase 0: sin `PresentadorHoja`) |
| Laboratorio (Debug, `-AceNeoLaboratorio`, `-AceNeoLaboratorioSeccion <n>`, `-AceNeoDesplazar <pt>`) | `Sources/Palco/Galeria/Laboratorio*.swift` |
| Pruebas | `Tests/AceNeoTests/Palco/{TokensTests,FuentesTests,IconosNumEstiloTests}.swift`; `Tests/AceNeoUITests/Palco/{LaboratorioUITests,SistemaUITests}.swift` |
| Marca | `Resources/Assets.xcassets/Marca.imageset` desde `apps/web/public/icon.svg`, una sola variante (`scripts/generar-recursos.mjs`, que ya no escribe colorsets ni toca el AppIcon) |

## 2. Cómo se comparó

- **Referencia web propia a @3x.** Las capturas de `final/sistema/` son de 390×844 a @1x y solo enseñan la primera
  pantalla. Para comparar pieza a pieza se capturó la galería **entera** del mismo build (`apps/web/dist` de la carpeta
  principal, `vite preview`, Chrome de Playwright, 390 de ancho, @3x, claro y oscuro, con y sin transparencia reducida,
  movimiento reducido; scripts en el scratch de la sesión: `capturar.mjs`, `medir.mjs`). Con `getBoundingClientRect`
  se sacaron las cajas de títulos, cifras, cápsulas, botones y chips.
- **El laboratorio se mide solo.** Cada pieza del bloque 1 lleva debajo su caja medida en el iPhone
  (`onGeometryChange`) y la de Chrome: verde si las dos casan a ±1 pt, rojo si no (`Medido`).
- **La galería se compara por tramos.** `SistemaUITests` abre la galería con `-AceNeoDesplazar 0, 700 … 8400` en claro y
  oscuro (y 3 tramos con transparencia reducida); un script (`comparar.py`, solo Pillow) busca franja a franja de 40 pt
  a qué altura de la web corresponde cada trozo: si el desfase no cambia dentro de una captura, las alturas casan; si
  deriva, dice en qué bloque sobra o falta.
- Simulador iPhone 16e (iOS 26.2, @3x, zonas 47/34), barra de estado fijada a las 9:41.

## 3. Resultado

### 3.1 Casa (±1 pt)

| Qué | iPhone | Web (Chrome) |
|---|---|---|
| «Agenda» 30/800/125, −0,02 em, lh 1,1 | 128,33 × 33,00 | 128,02 × 33,00 |
| «Agenda» 44 | 188,00 × 48,40 | 187,75 × 48,39 |
| «Hoy, miércoles 23» | 276,33 × 33,00 | 276,28 × 33,00 |
| Título de hoja 22/800/125 | 250,33 × 27,50 | 249,97 × 27,50 |
| Título de sección 17/720/125 | 164,67 × 24,65 | 164,38 × 24,64 |
| Cuerpo 15/450 en tres líneas (lh 21,75) | 260 × 65,42 | 260 × 65,25 |
| Toast 15/560 en dos líneas (lh 18,75) | 262 × 37,75 | 262 × 37,50 |
| `Num` «90+4'» a 64 | 136,41 × 64 | 135,95 × 64 |
| `Num` «2» a 64 (celda 0,49 em) | 31,36 × 64 | 31,36 × 64 |
| `Num` «21:00» a 17 | 36,65 × 17 | 36,45 × 17 |
| Cápsula 13/640/88 «En directo · 13'» (texto) | 75,00 × 13 | 75,00 × 13 |
| Cápsulas «En directo · 13'», «VIE 21:00», «Tu equipo», «Señal lista» sm | 108 · 90,33 · 94,33 · 78,00 | 108 · 90,22 · 94,31 · 77,81 |
| Botones «Ver partido», «Elegir fuente», «Pegar hash» sm | 146,00 · 127,67 · 36 de alto | 145,81 · 127,39 · 36 |
| Martian 12 con lh 1,45 (tras calibrar) | 265,33 × 17,40 | 265,20 × 17,39 |
| Chips «M+ Liga de Campeones», «DAZN 2», «En directo 3» | en el bloque 1, fuera de las dos capturas (se ven a ojo en la galería) | 158,03 · 80,83 · 81,44 |

- **Iconos**: los 52 a 24 casan trazo a trazo con la galería web (recortes lado a lado; el grosor 1,8/24, las puntas
  redondas y las piezas rellenas son las mismas). La variante «relleno + trazo» del reproductor (pausa, reproducir,
  detener, `tv`, «Toca para reproducir» a 32) está en el bloque 2.
- **Galería** (ejecución 36182415036, ya calibrada): el desfase es **constante dentro de cada captura** en todos los
  tramos (franjas de 40 pt, diferencia media de píxel casi siempre < 3/255): ninguna pieza cambia de alto respecto a la
  web. Acumulado desde arriba: −1 pt a 2 100, −3 pt entre 2 800 y 4 900 (el bloque «Señal», ±1 pt repartido en diez
  filas) y +12 pt desde «Avisos»: la región de la línea de estado de la web está siempre montada y deja su hueco de 12
  aunque esté vacía; corregido en `d10fff9` (compilado, sin recapturar).
- **Colores**: `TokensTests` resuelve cada token en claro y oscuro y lo compara con el hex de la web (36 tokens y 6
  mezclas). Las islas oscuras (`.islaOscura()`) dan los valores oscuros aunque la app esté en claro.
- **Transparencia reducida**: el cristal pasa al sólido exacto (`--glass-solid` / `--glass-video-solid`); las cápsulas
  de directo y oro conservan su color (b-arquitectura §0.4).
- **Canarios de banco** (c0-canarios.md, «banco pendiente»): C1 cristal ✓, C3 pan horizontal que cede al carril ✓
  (bloque 7), C5 háptica con hoja abierta ✓ (compila y no rompe; la vibración solo se nota en el iPhone), C6 hoja
  `.height(medido)` sin saltos ✓, C7 menú contextual con vista previa ✓, C9 rueda y paleta ✓ (bloque 7), C13 tema de la
  ventana ✓ (el matiz por zona lo pone `HostingRaiz`, 0.3b), C14 `IconoImagen` en `Menu` ✓, subir con la barra de
  estado ✓ (`testTocarLaBarraDeEstadoSube`).

### 3.2 Se calibró

| Qué no casaba | Medido | Arreglo |
|---|---|---|
| **Martian Mono**: 12 pt con lh 1,45 medía 20,07 en vez de 17,39; cada muestra de color y cada celda de icono salía 2,7 pt más alta y la galería derivaba ~2,5 pt por fila | su caja natural es 1,2 em (hhea/typo 1000/−200, a diferencia de Palco Sans, 1 em) | `Martian.altoNatural` + `.altoDeLineaMartian(lh, tamano:)`; `.estilo()` lo usa solo en los estilos `mono` |
| Etiqueta de campo, pista, error, segmento, menú, línea de estado, rótulo de la barra, «Modo demo», motor | en la web heredan `line-height: 1,45` del `body`; aquí medían 1 em (la tarjeta «Campos» salía 6 pt más baja) | `altoLinea: 1.45` en esos estilos de `EstiloTexto` |
| Hueco entre la cabecera de la galería y el primer bloque | faltaban los 32 de `.sis` | separación `S.s8` |
| Cápsulas y pastillas del bloque en cristal de la galería | en la web se estiran a la celda de la rejilla | `.environment(\.llenarAncho, true)` (nuevo, lo leen `Capsula` y `PastillaCompeticion`) |

### 3.3 No casa (o no se calca)

- **Cristal (Liquid Glass)**: es «aceptable» en los dos temas pero no idéntico. En claro, el cristal regular y el denso
  sobre la retransmisión de mentira salen con un reflejo verde/melocotón más vivo que el blanco al 72 %/90 % con
  desenfoque de la web; en oscuro casan mucho mejor. El tinte está en un solo sitio (`CristalPalco.vidrio`) para que I2
  lo ajuste con las capturas de las vistas reales (barra, mini, toasts).
- **Hoja nativa**: con detent medido, iOS 26 la pinta flotante (separada de los bordes, radio 24 en las cuatro
  esquinas); la web la pega a los bordes. Es la decisión 5 (hoja nativa); el contenido (título, descripción, campo,
  pie con botones que se estiran) casa.
- **Halo de los escudos encendidos en la galería**: en la web el `::after` con `z-index: -1` queda debajo del fondo de
  la tarjeta y no se ve (solo se ve dentro de la tarjeta versus, que tiene `isolation`); aquí se ve siempre. Es un
  artefacto de la web: en el versus y en la cabecera del partido los dos lo pintan.
- **Hash en Martian**: corta la línea una palabra antes que Chrome («· 48 pares» baja entera); el ancho del texto casa
  a 0,13 pt: es la regla de corte de línea, no la fuente.
- Los colores de club que salen de lib/color.ts y lib/teams.ts (`channelTone`, `competitionShort`, mezclas del versus)
  están portados **provisionalmente** en `Palco/Componentes/TonosMarca.swift` y `MezclaOKLab` hasta que M2 porte
  lib/color.ts con vectores; `versusPair` y `teamLight` no están (la galería pone las mitades y el halo a mano).

## 4. Ejecuciones de la CI (rama `nativa/palco`)

| Id | Tipo | Resultado | Qué |
|---|---|---|---|
| 36176437738 | solo_compilar | rojo | una expresión lenta de tipar en `MarcaCanal` (410 ms) |
| 36178240577 | solo_compilar | verde | Palco, galería, laboratorio y pruebas |
| 36178707780 | completa (capturas) | rojo | 3 pruebas de `FuentesTests` (el nombre PostScript de una fuente con variación lleva los ejes; CoreText no lista un eje que vale su defecto), `testHapticaConHoja` (tocaba el botón de debajo de la hoja) y `ServidorRealUITests` (interfaz vieja, no es de P). Capturas: todas |
| 36182415036 | completa (capturas) | rojo solo por `ServidorRealUITests` | unitarios en verde (con los de Palco); `LaboratorioUITests` y `SistemaUITests` en verde; capturas de la calibración (artefacto `AceNeo-capturas`) |
| 36185345806 | solo_compilar | verde | hueco de la línea de estado de la galería |

## 5. Para quien siga

- **M4** (raíz de 0.3b): `RaizView` provisional abre `LaboratorioView` con `-AceNeoLaboratorio` y `SistemaView` con
  `-AceNeoSistema` (Debug); la raíz definitiva debe conservar esas dos entradas. El tema de la galería va hoy directo a
  la ventana (`EstadoGaleria.aplicarTema`): cuando exista `PreferenciasLocales`, el segmentado llama a `cambiarTema`.
- **M4**: el laboratorio usa las hojas y el menú contextual de los canarios C6/C7 (y la hoja UIKit de
  `PresentadorHoja`) porque la regla R5 solo deja `.sheet(`/`.contextMenu(` en `Armazon/`; al borrar `Sources/Sonda`
  hay que pasarlo a `Hojas.swift` y `Menus.swift`.
- **M2**: `Core/Reglas/Color/ColorOKLab.swift` tiene solo `RGB` (firma del contrato); el port de lib/color.ts,
  lib/teams.ts y `channelTone`/`channelDorsal`/`channelAbbrev`/`competitionShort` sustituye a
  `Palco/Componentes/TonosMarca.swift` y `MezclaOKLab`. `Num.segmentos` es `splitDigits` (NumTests).
- **I2**: el tinte del cristal en claro (§3.3) y la sombra de la barra se ajustan en `CristalPalco.vidrio` y
  `SombraPalco`; la referencia @3x de la galería se rehace con los scripts de §2.

## 6. Cierre de la fase 0 (I0, 25-sep-2026)

- **Fusionado** en `rediseno/nativa`. El banco y la galería viven dentro de `RaizView` (`-AceNeoLaboratorio`,
  `-AceNeoSistema`) con el entorno de la app: háptica central, hojas por `CentroHojas` (`Hoja.muestra`), menú por
  `menuContextual`, tema y transparencia de `PreferenciasLocales` (`HostingRaiz` los pone en la ventana) y ventana por
  `EstadoVentana`. Fuera `PresentadorHoja`, `VentanaPalco`, `ModoGaleria` (`ModoEjecucion.desplazar` y
  `.seccionLaboratorio`) y los tipos `Sonda*`. Con `-AceNeoApariencia` el tema arranca en «Sistema» (como el
  `prefers-color-scheme` de las capturas de la web).
- Bloques nuevos: 5 con «Barra clara» e «Inmersivo», 6 con la cuenta de pulsos, 8 «Marcos del vuelo» y 9 «Calibración
  del tinte».
- **Cristal en claro (§3.3, resuelto para que lo apruebe el integrador jefe).** Seis tintes (regular y `clear`,
  blanco 0,72 a 1,00; bloque 9) dejaban el reflejo: la barra media (228,247,226)→(227,243,248) de izquierda a derecha
  frente a (231,242,234)→(230,237,238) de la web. Ahora `CristalPalco.vidrio` no tiñe en claro y `CristalPalco.velo`
  pone `--glass`/`--glass-dense` encima del vidrio, como `.glass { background }` sobre el desenfoque de la web: la
  barra queda uniforme, (242,245,242)→(241,243,244), algo más blanca y menos verde que la web (la web satura 1,5 lo
  que asoma). En oscuro no cambia nada (27,36,37 frente a 21,39,34 de la web). El cristal de vídeo pinta siempre en
  oscuro (`.glass--video { color-scheme: dark }`): en claro el botón de vídeo ya no sale gris sobre la imagen.
  Pares web/app en `c0-cristal/`: `{web,app}-{barra,capsula,boton-video}-{claro,oscuro}.png` (web: Chrome @3x sobre
  la `.sis-glass` de la galería, la barra real y un `icon-btn--video` en `.glass--video`; app: `laboratorio-3-*`
  de la ejecución 36192007911) y el antes, `app-antes-{barra,boton-video}-claro.png`.
- Canarios de banco cerrados: ver `c0-canarios.md`, «Cierre de la fase 0».
