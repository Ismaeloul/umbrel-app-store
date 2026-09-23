# Referencias de diseño para Ace Player Neo v2

> Paso 2.0 · investigación previa a las maquetas. Hecha el 22-sep-2026.
> Objetivo: saber qué hacen bien hoy las mejores apps de fútbol y de vídeo, qué
> ha cambiado con Liquid Glass y qué tendencias siguen vigentes, para proponer
> **principios** y **3 territorios visuales** que no se parezcan a la 0.6.59
> (casi negro `#07090c` + ámbar `#d8a860`, Outfit + Inter + JetBrains Mono,
> tarjetas en rejilla) ni entre sí.
>
> **Cómo leer cada ficha:** *qué hace bien* → *patrón aprovechable aquí* (en
> términos de las vistas reales de la app: agenda, centro de partido, selector de
> fuentes, reproductor, biblioteca, panel nerd) → *enlaces*. Cuando algo es una
> advertencia y no un modelo, va marcado como **Lección**.
>
> **Qué se ha comprobado a mano, no solo leído:**
> - Las fuentes de §6: ejes variables, `tnum` (cifras tabulares), glifos del
>   español y licencia, descargando los TTF del repositorio `google/fonts` y
>   leyéndolos con fontTools.
> - Las paletas de §8: pasadas de OKLCH a sRGB y con el contraste WCAG calculado
>   (fórmula de luminancia relativa), no a ojo.
> - Los campos de color y escudo de los equipos en la API de marcadores de ESPN
>   (la que ya usa el backend para `/api/scores`), con una petición real (§5).
>
> No se copia ningún logotipo ni marca. Los escudos de los clubes que salgan en
> la app son **contenido** que llega de la fuente de datos, no parte de nuestra
> identidad; en las maquetas se usarán escudos genéricos.

---

## Índice

1. [Apps de fútbol y marcadores](#1-apps-de-fútbol-y-marcadores)
2. [Vídeo y streaming](#2-vídeo-y-streaming)
3. [Liquid Glass (iOS 26 → iOS 27) y lo que significa para la web](#3-liquid-glass-ios-26--ios-27-y-lo-que-significa-para-la-web)
4. [Tendencias de UI vigentes](#4-tendencias-de-ui-vigentes)
5. [Datos que condicionan el diseño](#5-datos-que-condicionan-el-diseño)
6. [Tipografías candidatas verificadas](#6-tipografías-candidatas-verificadas)
7. [Síntesis: principios para Ace Player Neo](#7-síntesis-principios-para-ace-player-neo)
8. [Síntesis: tres territorios visuales](#8-síntesis-tres-territorios-visuales)

---

## 1. Apps de fútbol y marcadores

### 1.1 Apple Sports

- **Qué hace bien.**
  - Es un marcador puro: abre y ves resultados, sin noticias ni vídeo que
    estorben. Pestañas "Ayer / Hoy / Próximos", que es exactamente el modelo
    mental del aficionado.
  - Los números del marcador usan la fuente variable del sistema **en negrita y
    con el ancho comprimido**: mucha cifra en poco sitio y sin perder presencia.
  - Los colores de los equipos son el fondo: degradados animados con puntos que
    se mueven un ±10 %, un brillo encima y una textura de tejido de camiseta
    deformada por un *shader*. Nada queda "muerto" aunque el dato sea estático.
  - Rótulos con *vibrancy* (varias capas de relleno con modos de fusión) que
    dejan pasar el color del equipo sin perder legibilidad; tablas densas sobre
    "platos" translúcidos que se recolocan bien con Dynamic Type.
  - En 2026: vista de cuadro eliminatorio, **alineaciones con formación** en la
    ficha del partido, Live Activities en la pantalla de bloqueo y el reloj,
    widgets, y 170 países.
- **Patrón aprovechable.**
  - Pestañas temporales en la agenda ("Ayer · Hoy · Mañana · …") en lugar de una
    tira de días neutra: la 0.6.59 ya tiene "Hoy/Mañana", pero sin jerarquía.
  - Cifras condensadas y gruesas para marcador y minuto, en una fuente con eje
    de anchura (ver §6).
  - El color de los dos equipos como **luz de fondo** del centro de partido, con
    movimiento lento que se apaga con `prefers-reduced-motion`.
- **Enlaces.**
  [Crítica de diseño de Lickability](https://lickability.com/blog/apple-sports/) ·
  [Apple Newsroom, mayo 2026 (Mundial, 90 países más)](https://www.apple.com/newsroom/2026/05/apple-sports-expands-to-more-than-90-new-countries-and-regions/) ·
  [9to5Mac, julio 2026 (formaciones, 7 ligas más)](https://9to5mac.com/2026/07/20/apples-sports-app-expands-soccer-features-heres-whats-new/) ·
  [MacRumors, mayo 2026](https://www.macrumors.com/2026/05/19/apple-sports-app-2026-world-cup/)

### 1.2 FotMob

- **Qué hace bien.**
  - Ficha de partido por pestañas (Hechos, Estadísticas, Alineación) con una
    mini-sección de datos clave arriba y el detalle debajo.
  - **Gráfico de "momento"**: una sola línea que sube y baja según quién aprieta;
    se lee de un vistazo el partido entero.
  - Guía de TV (cuándo y dónde se emite), Live Activities en la Isla Dinámica y,
    desde el 11-sep-2026, widgets de liga y de favoritos en **tamaño extra
    grande** para ver toda la jornada sin abrir la app.
  - Muestra el motivo de cada tarjeta en el relato del partido (dato concreto,
    no genérico).
- **Patrón aprovechable.**
  - "Momento" aplicado a la **señal**: una línea de pares o de velocidad de las
    últimas decenas de segundos en la ficha de la fuente activa. Cuenta si la
    señal mejora o empeora mejor que un número suelto.
  - Guía de TV = nuestra agenda: el "dónde" (canales y fuentes) es el dato
    estrella, no un añadido.
- **Enlaces.**
  [FotMob en la App Store (notas de versión)](https://apps.apple.com/us/app/fotmob-soccer-live-scores/id488575683) ·
  [Anuncio de los gráficos de momento](https://x.com/FotMob/status/1640642231223701507) ·
  [xG en la ficha de partido](https://www.fotmob.com/topnews/3627-Live-xG-data-is-now-in-FotMob)

### 1.3 Sofascore

- **Qué hace bien.**
  - *Attack Momentum*: gráfico de presión en tiempo real con las incidencias
    principales (goles, tarjetas) dibujadas sobre la propia curva.
  - Notas de jugador en una escala de color fija que se aprende una vez y se lee
    en toda la app.
  - "Marcador inteligente" que agrupa partidos de varios deportes; mapas de
    tiros y de calor; Live Activities.
  - Versión 26.09.14 (esta semana): integra **emisiones en directo de YouTube**
    en los partidos que las tienen. Un marcador que ya enseña vídeo.
- **Patrón aprovechable.**
  - Una **escala de color fija y aprendible** es justo lo que pide el estado de
    las fuentes (verde, ámbar, rojo, "comprobando"). Sofascore demuestra que
    funciona si se usa igual en todas partes.
  - Incidencias sobre la línea de tiempo: los cortes y cambios de fuente se
    pueden marcar sobre la línea de señal del panel nerd.
- **Enlaces.**
  [Cómo nació el Attack Momentum](https://www.sofascore.com/news/how-sofascores-attack-momentum-changed-sport-analysis) ·
  [Sofascore en la App Store](https://apps.apple.com/us/app/sofascore-live-sports-scores/id1176147574)

### 1.4 OneFootball

- **Qué hace bien.**
  - Temporada 2025/26: indicadores de "en vivo" **dentro de la clasificación**
    (ves cómo va el rival sin salir de la tabla), xG y probabilidad de victoria
    en el directo, y menos publicidad en portada.
  - La identidad de 2020 (DesignStudio) sigue siendo la referencia de un modo
    oscuro de fútbol limpio y sin ruido.
- **Patrón aprovechable.**
  - Poner el estado vivo **donde el usuario ya está mirando**: "EN DIRECTO" y
    la señal dentro de la fila de la agenda y en la tarjeta de canal de la
    biblioteca ("En pantalla"), no en una pantalla aparte.
- **Enlaces.**
  [Mejoras de la temporada 2025/26](https://onefootball.com/en/news/onefootball-app-improvements-as-the-202526-season-gets-underway-41516423) ·
  [La identidad de OneFootball (Creative Review)](https://www.creativereview.co.uk/onefootball-branding-design-studio/)

### 1.5 LaLiga (app oficial 2026/27)

- **Qué hace bien.**
  - Versión 8.0 (1-jul-2026): la mayor actualización de su historia, rediseño
    completo con una "experiencia en directo" basada en **Live Activities y
    widgets** para seguir al equipo sin abrir la app.
  - Sección "Mi equipo favorito" con los **colores del club** y su plantilla.
- **Patrón aprovechable.**
  - Personalizar con el color del equipo, que la 0.6.59 no hace aunque ya sabe
    tus equipos ("Para ti"): la fila de tu partido puede llevar el color de tu
    club sin cambiar de sitio (la regla de "resaltado sin reordenar" se
    mantiene).
- **Enlaces.**
  [LALIGA en la App Store](https://apps.apple.com/us/app/laliga-official-app-2026-2027/id545609647) ·
  [Novedades de LALIGA 2026/27](https://www.laliga.com/en-GB/news/the-10-new-features-shaping-laliga-in-2026-27-innovation-broadcasting-and-financial-sustainability)

### 1.6 Premier League (app 2025/26)

- **Qué hace bien.** "Matchday Live" con marcador, estadísticas y enlaces a la
  emisión; "Matchday Stories" en vertical; "myPremierLeague" para personalizar
  por club y jugador.
- **Lección.** Parte de las reseñas la encuentran recargada: cuesta llegar a un
  dato básico (máximo goleador). Añadir capas (IA, historias, fantasy) sin
  jerarquía entierra lo esencial. En Ace Player Neo lo esencial es "qué hay,
  qué está en directo y si hay señal"; todo lo demás cede.
- **Enlaces.**
  [Lanzamiento de las nuevas plataformas (1-jul-2025)](https://www.premierleague.com/en/news/4337361/premier-league-launches-new-fan-facing-platforms-as-part-of-digital-transformation) ·
  [SportsPro sobre las funciones de IA](https://www.sportspro.com/news/premier-league-app-ai-features-microsoft-adobe-september-2025/) ·
  [Identidad de la Premier: "hablar, no gritar" (Design Week)](https://www.designweek.co.uk/new-premier-league-identity-looks-to-talk-and-not-shout/)

### 1.7 ESPN (app renovada, 21-ago-2025)

- **Qué hace bien.**
  - **Squeeze-back**: el vídeo se encoge para dejar sitio a estadísticas o
    jugadas clave sin dejar de verse.
  - Botones "Desde el principio" y **"Volver al directo"**.
  - Multiview en formatos fijos de 2, 3 o 4 partidos.
  - "SportsCenter For You" y un *feed* vertical.
- **Patrón aprovechable.**
  - "Volver al directo" encaja con el reproductor v2, que ya mide el retraso
    real respecto al directo: un botón que solo aparece cuando te has quedado
    atrás.
  - *Squeeze-back* = cómo abrir el selector de fuentes o el panel nerd en
    escritorio: el vídeo cede ancho, no se tapa.
- **Enlaces.**
  [Sports Video Group: multiview, estadísticas y repeticiones](https://www.sportsvideo.org/2025/08/20/espns-revamped-dtc-app-delivers-multiview-live-game-stats-highlight-replays-and-much-more/) ·
  [Nota de prensa de ESPN](https://espnpressroom.com/us/press-releases/2025/08/espn-launches-new-direct-to-consumer-service-enhanced-espn-app/)

### 1.8 DAZN

- **Qué hace bien.** Multiview "hazlo tú" de hasta 4 partidos en web, tableta y
  Apple TV (2 en móvil). *Content Select and Switch*: partido completo,
  resumen o "partido en 40 minutos" **desde una sola tesela**.
- **Patrón aprovechable.**
  - La fila de partido como tesela única con sus opciones dentro (ver, elegir
    fuente, copiar enlace), sin saltar a otra pantalla para decidir.
  - Límite realista en móvil (2 vídeos) si algún día hay multiview; hoy el
    motor no garantiza dos canales a la vez (ver `docs/dudas.md`).
- **Enlaces.**
  [DAZN: novedades de NFL Game Pass 2025](https://dazngroup.com/press-room/dazn-introduces-enhanced-features-and-fan-innovations-on-nfl-game-pass-for-the-2025-nfl-season/) ·
  [SportsPro sobre el multiview](https://www.sportspro.com/news/nfl-dazn-game-pass-enhancements-spain-rights-september-2025/)

### 1.9 Prime Video (deportes en directo)

- **Qué hace bien.** *Rapid Recap* (resumen de menos de dos minutos que te deja
  en el directo), *Key Moments* y estadísticas sin salir del partido.
- **Patrón aprovechable.** Entrar tarde a un partido y ponerse al día sin
  perder el directo. Aquí no hay repeticiones, pero sí se puede enseñar
  "qué ha pasado" (marcador e incidencias de ESPN) en una línea al entrar, con
  el marcador tapado si así lo quiere el usuario.
- **Enlaces.**
  [Sports Video Group: funciones interactivas de la NBA en Prime](https://www.sportsvideo.org/2025/09/30/prime-video-to-open-nba-coverage-with-interactive-broadcast-features/) ·
  [About Amazon: la IA en los deportes en directo](https://www.aboutamazon.com/stories/prime-video-ai-live-sports-viewers-tv)

### 1.10 El marcador de la tele (*scorebug*), 2025-2026

- **Qué hace bien.**
  - Fox (2025) quita las cajas y deja que la **tipografía** lleve la identidad;
    luego cambió las siglas por escudos. CBS casi **duplica el tamaño del
    marcador** en 2025. ESPN estrena paquete en agosto de 2026.
  - El artículo de SVG (junio de 2026) resume las reglas: proteger la
    jerarquía ("¿qué es lo primero que hay que leer? ¿y lo segundo?"), que se
    lea en un bar y en un móvil, el movimiento como función (lo secundario
    aparece un momento y se va) y un estado base limpio con estados ampliados
    muy medidos.
- **Patrón aprovechable.** El *scorebug* es un componente con tres décadas de
  pruebas sobre la legibilidad del marcador y el minuto. El marcador de la
  fila de agenda, el del centro de partido y el del mini-reproductor pueden
  ser el **mismo componente a tres tamaños**.
- **Enlaces.**
  [SVG: diseñar el scorebug moderno (9-jun-2026)](https://www.sportsvideo.org/2026/06/09/designing-the-modern-scorebug-how-broadcast-graphics-teams-are-rethinking-the-most-important-element-on-screen/) ·
  [NewscastStudio: el de Fox 2025](https://www.newscaststudio.com/2025/09/25/fox-sports-nfl-score-bug-2025-season/) ·
  [NewscastStudio: el de CBS 2025](https://www.newscaststudio.com/2025/09/12/cbs-nfl-score-bug-update-2025/) ·
  [NewscastStudio: el nuevo de ESPN (ago-2026)](https://www.newscaststudio.com/2026/08/27/espn-debuts-new-nfl-graphics-score-bug-ahead-of-first-super-bowl/) ·
  [Daring Fireball sobre la resistencia al cambio](https://daringfireball.net/2025/02/fox_new_scorebug_graphic_design)

---

## 2. Vídeo y streaming

### 2.1 Apple TV (app, iOS 26 y tvOS 26)

- **Qué hace bien.** Carteles verticales más cinematográficos (caben más
  títulos), barra de pestañas de Liquid Glass y **controles transparentes que
  flotan sobre el vídeo**: "el diseño mantiene el foco en lo que se está
  viendo".
- **Patrón aprovechable.** Los controles propios del reproductor v2 (hoy
  "controles NEO", solo en escritorio) como cápsulas de cristal sobre el vídeo;
  el vídeo nunca queda detrás de una barra opaca.
- **Enlaces.**
  [Apple Newsroom: rediseño de Apple TV](https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/) ·
  [9to5Mac: la app TV en iOS 26](https://9to5mac.com/2025/07/16/apples-tv-app-gets-fresh-design-in-ios-26-and-tvos-26-heres-whats-new/)

### 2.2 Netflix (TV 2025 y móvil 2026)

- **Qué hace bien.**
  - TV (mayo de 2025, primer rediseño de portada desde 2013): navegación
    arriba y siempre visible; **etiquetas en la propia tesela** ("Nº 1 en
    series", "Nueva temporada"); *color feeding*, el fondo toma el color del
    título enfocado.
  - Móvil (desde el 29-abr-2026): "Clips", un *feed* vertical para decidir qué
    ver.
- **Patrón aprovechable.**
  - Etiquetas en la fila: "En directo", "Tu equipo", "3 fuentes verificadas",
    "Sin señal aún". Deciden sin abrir nada.
  - *Color feeding* con los colores de los equipos del partido enfocado
    (escritorio) o del que suena (móvil).
- **Enlaces.**
  [Netflix: el nuevo diseño de TV](http://about.netflix.com/en/news/unveiling-our-innovative-new-tv-experience) ·
  [Tudum: guía del nuevo diseño](https://www.netflix.com/tudum/articles/netflix-new-tv-layout) ·
  [Variety](https://variety.com/2025/tv/news/netflix-redesigns-homepage-ai-chatbot-1236388858/) ·
  [Fast Company: Netflix se pasa al vertical](https://www.fastcompany.com/91534522/netflix-goes-vertical-with-its-new-mobile-app) ·
  [Engadget: el rediseño móvil](https://www.engadget.com/entertainment/streaming/netflix-mobile-app-redesign-will-offer-deeper-integration-of-vertical-video-120000820.html)

### 2.3 HBO Max

- **Qué hace bien.** Portada con avances que se reproducen solos y navegación
  lateral en televisores (2025, antes de volver a llamarse HBO Max en julio).
- **Lección.** Aquí **no** sirve el avance automático: cada vista previa
  abriría una sesión en el motor AceStream, y el backend v2 abre una sesión
  por contenido y cierra las que se quedan sin espectadores (decisión D5). Una
  portada con avances automáticos mataría la sesión del canal que suena. La
  vida de la portada tiene que salir de los datos (marcadores, estados de
  señal), no de vídeo.
- **Enlaces.**
  [TV Tech: Max actualiza su portada](https://www.tvtechnology.com/news/max-updates-homepage-user-interface)

### 2.4 YouTube (reproductor nuevo, desde el 14-oct-2025)

- **Qué hace bien.** Cada control en su propia **burbuja translúcida**; "Me
  gusta", "No me gusta", comentarios y guardar agrupados en una sola cápsula;
  iconos más gruesos y redondeados; animación nueva del doble toque para
  avanzar, "menos intrusiva"; transiciones más suaves entre pestañas. El
  objetivo declarado: **tapar menos vídeo**.
- **Patrón aprovechable.** Agrupar las acciones de la fuente activa (favorito,
  copiar, pegar hash, reportar, "es el canal correcto") en una cápsula
  única y no en una fila de botones sueltos como en el inspector de la 0.6.59.
- **Enlaces.**
  [9to5Google: despliegue del nuevo reproductor](https://9to5google.com/2025/10/14/youtube-video-player-redesign-more/) ·
  [9to5Google: la prueba con aire de Liquid Glass](https://9to5google.com/2025/07/10/youtube-video-player-redesign-test/)

### 2.5 Twitch

- **Qué hace bien.** El *feed* de descubrimiento enseña directos de verdad,
  sin anuncio previo, y un toque te mete en el canal; desde 2025 admite
  emisiones en vertical.
- **Lección.** El rediseño de 2024 se recibió fatal al principio: mover la
  navegación de golpe rompe la costumbre. En la v2 los caminos de siempre
  (Ver canal, Buscar canal, Pegar hash, Favoritos) tienen que seguir a uno o
  dos toques.
- **Enlaces.**
  [Blog de Twitch: la nueva app móvil](https://blog.twitch.tv/en/2024/07/29/find-content-you-love-faster-with-the-new-twitch-mobile-app/) ·
  [Dexerto: emisión en vertical](https://www.dexerto.com/twitch/twitch-reveals-major-change-to-make-streams-a-lot-more-like-tiktok-3149774/)

### 2.6 Plex (el pariente autoalojado)

- **Qué hace bien.** En móvil, la carátula **se funde en un degradado del
  mismo color** detrás de los botones de ver y guardar.
- **Lección.** En septiembre de 2025 quitó la barra lateral para poner
  pestañas arriba y **tuvo que devolverla en agosto de 2026** tras un año de
  quejas: la memoria muscular manda, sobre todo en una app que se usa a
  diario. Es la lección más cercana a este proyecto (app personal de uso
  diario, rehecha entera).
- **Enlaces.**
  [Blog de Plex: la nueva experiencia](https://www.plex.tv/blog/the-new-plex-experience/) ·
  [How-To Geek: Plex devuelve la barra lateral](https://www.howtogeek.com/plex-brings-back-sidebar-navigation-after-users-refuse-to-let-it-go/) ·
  [XDA: volver a la app clásica](https://www.xda-developers.com/plexs-classic-app-is-better-than-its-modern-redesign-so-i-went-back/)

---

## 3. Liquid Glass (iOS 26 → iOS 27) y lo que significa para la web

### 3.1 Qué es y cuáles son sus reglas

- **Presentación (9-jun-2025).** Un material translúcido que refleja y refracta
  lo que tiene debajo y se transforma para centrar la atención en el contenido.
  Llega a iOS, iPadOS, macOS, watchOS y tvOS 26.
- **Reglas de uso** (sesión *Meet Liquid Glass* y guía de adopción):
  - Es para la **capa de navegación que flota sobre el contenido** (barras de
    pestañas, barras de herramientas, controles), no para el contenido en sí.
  - **Nunca cristal sobre cristal.** Para separar capas dentro del contenido se
    usan rellenos y transparencias normales.
  - Dos variantes. *Regular*, la de casi siempre, adaptativa. *Clear*, más
    transparente y sin adaptación, **solo** sobre contenido rico en imagen
    (vídeo) y cuando una capa de oscurecimiento no estropea lo de debajo.
  - **Tinte solo en la acción principal**, nunca como decoración.
  - **Formas concéntricas**: el radio interior se calcula a partir del
    contenedor y del dispositivo; si una esquina "chirría", es que no es
    concéntrica.
  - Al tocarlo, el cristal "se flexiona y se ilumina" con elasticidad de gel.
- **Accesibilidad.**
  - Desde iOS 26.1: Ajustes > Pantalla y brillo > Liquid Glass, con "Claro" o
    "Tintado" (más opaco y con más contraste).
  - "Reducir transparencia" oscurece los fondos translúcidos.
- **iOS 27 (WWDC, 8-jun-2026):**
  - Difumina mejor el contenido complejo.
  - **Borde oscurecido** alrededor de los elementos de cristal y brillos
    especulares más vivos.
  - **Regulador de transparencia** de "ultra claro" a "tintado del todo".
  - Barra superior uniforme cuando el contenido pasa por debajo, para que el
    texto se lea.
  - Se adapta solo a "Reducir transparencia" y "Aumentar contraste".
  - Icon Composer admite iconos de **varias capas de cristal** con refracción.
- **Patrón aprovechable.**
  - En **iOS** la app nativa usa el cristal del sistema y no lo imita:
    `TabView`, barras y hojas lo traen gratis y respetan los ajustes del
    usuario.
  - En la **web** se aplican las mismas reglas: cristal solo en la
    navegación flotante y sobre el vídeo, nunca sobre listas largas y nunca
    anidado.
- **Enlaces.**
  [Apple Newsroom (9-jun-2025)](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) ·
  [WWDC25: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) ·
  [WWDC25: Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) ·
  [Notas de la sesión (WWDCNotes)](https://wwdcnotes.com/documentation/wwdc25-219-meet-liquid-glass/) ·
  [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) ·
  [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) ·
  [BGR: opción "Tintado" en iOS 26.1](https://www.bgr.com/2030125/how-to-make-liquid-glass-easier-read-ios-26-1-guide/) ·
  [MacRumors: Reducir transparencia](https://www.macrumors.com/how-to/ios-reduce-transparency-liquid-glass-effect/) ·
  [MacRumors: cambios en iOS 27](https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/) ·
  [AppleInsider: iOS 27](https://appleinsider.com/articles/26/06/08/ios-27-gets-better-liquid-glass-and-more-responsiveness) ·
  [Neowin: el regulador](https://www.neowin.net/news/apple-finally-brings-the-slider-for-liquid-glass-and-many-other-changes/)

### 3.2 Llevarlo a la web: límites reales

| Tema | Qué pasa | Consecuencia para la v2 |
|---|---|---|
| Refracción de verdad | Solo Chromium acepta filtros SVG (`feDisplacementMap`) como `backdrop-filter`, y cambiar forma o tamaño obliga a regenerar el mapa (caro). | No se imita la lente. Se usa `backdrop-filter: blur() saturate()`, un relleno semitransparente, un borde de 1 px con brillo arriba y el "borde oscurecido" de iOS 27. En Safari se ve igual. |
| Desenfoque en iOS Safari | Un elemento fijo o *sticky* con `backdrop-filter` obliga a WebKit a volver a desenfocar lo de debajo **en cada fotograma de scroll**. Es la causa número uno de tirones en listas. | Barra inferior y cabecera **casi opacas** (≈ 90-95 %) sobre listas; desenfoque real solo sobre el vídeo o sobre fondos que no se desplazan. Máximo 2-3 capas desenfocadas visibles a la vez. |
| `prefers-reduced-transparency` | Solo Chrome y Edge (118+) y Opera (104+). Safari (tampoco en 27.2) y Firefox, no. | Interruptor propio "Reducir transparencia" en Ajustes (guardado por visor), que arranca activado cuando la consulta existe y da `reduce`, y respaldo opaco con `@supports not (backdrop-filter: blur(1px))`. |
| Transiciones | Las View Transitions **dentro del mismo documento** son Baseline desde octubre de 2025 (Chrome 111, Safari 18, Firefox 144). Las de documento a documento aún no. | La web es una SPA: sirven para el "elemento compartido" fila de partido → centro de partido. |

- **Enlaces.**
  [kube.io: Liquid Glass con CSS y SVG](https://kube.io/blog/liquid-glass-css-svg/) ·
  [PR con la medición de tirones en iOS](https://github.com/mwhobrey/domi-ops/pull/57) ·
  [Can I use: prefers-reduced-transparency](https://caniuse.com/mdn-css_at-rules_media_prefers-reduced-transparency) ·
  [Chrome: prefers-reduced-transparency](https://developer.chrome.com/blog/css-prefers-reduced-transparency) ·
  [Modern CSS Daily (4-sep-2026)](https://modern-css.davecross.co.uk/2026/09/04/prefers-reduced-transparency/) ·
  [web.dev: View Transitions Baseline](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available)

### 3.3 Iconos (iOS 26/27) y el icono de la PWA

- **Qué pide iOS 26.** Seis apariencias: por defecto, oscura, clara-luz,
  clara-oscura, tintada-luz y tintada-oscura. Se diseñan **tres** (por
  defecto, oscura y mono) en capas con Icon Composer y el sistema saca el
  resto. El símbolo no cambia entre variantes; solo el fondo.
- **Qué cambia en iOS 27.** Iconos más nítidos y refracción aplicada con
  medida; Icon Composer admite varias capas de cristal.
- **El problema de la PWA.** El icono de una web instalada no recibe
  variantes oscura, clara ni tintada en iOS 26: en un hilo de los foros de
  desarrolladores se ve "muy pobre" en tintado y claro, y Apple no ha
  contestado.
- **Consecuencia.**
  - El símbolo del icono nuevo tiene que funcionar **en una sola tinta**:
    silueta clara y sin depender de degradados ni del color de marca.
  - La PWA lleva un PNG opaco bien contrastado.
  - La app nativa, el `.icon` de tres capas.
- **Enlaces.**
  [HIG: App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) ·
  [Icon Composer](https://developer.apple.com/icon-composer/) ·
  [Create with Swift: iconos con Icon Composer](https://www.createwithswift.com/crafting-liquid-glass-app-icons-with-icon-composer/) ·
  [Tamaños y variantes en iOS 26](https://www.applaunchflow.com/blog/ios-26-app-icon-sizes-variants) ·
  [Foro de Apple: iconos de PWA en iOS 26](https://developer.apple.com/forums/thread/787919)

---

## 4. Tendencias de UI vigentes

### 4.1 Bento

- **Qué es.** Teselas de tamaños distintos en una rejilla, cada una con un
  tipo de dato (vídeo, número grande, lista). Densidad sin ruido; se "picotea"
  en vez de leer de arriba abajo.
- **Cuándo encaja aquí.** En el **centro de partido de escritorio**: vídeo
  grande, marcador y reloj, fuentes con su señal, información del partido,
  panel nerd plegado. **No** en la agenda ni en la biblioteca: el bento con
  todas las teselas iguales es justo la "rejilla de tarjetas sin jerarquía"
  que Isma no quiere.
- **Regla.** El tamaño de la tesela = su importancia. Si todas miden lo mismo,
  no es bento: es una rejilla.
- **Enlaces.**
  [Midrocket: tendencias de UI 2026](https://midrocket.com/en/guides/ui-design-trends-2026/) ·
  [Brucira: bento, cristal y modo oscuro](https://blog.brucira.com/top-ui-design-trends/)

### 4.2 Tipografía variable expresiva y números tabulares

- **Qué es.**
  - Material 3 Expressive (mayo de 2025) mete tipografía variable, formas y
    color más atrevidos. Según Google: 46 estudios con más de 18.000
    participantes, y los elementos clave se encuentran **hasta 4 veces más
    rápido**.
  - En el deporte, Apple Sports usa el eje de anchura para el marcador y los
    rótulos de TV dejan la identidad en manos de la tipografía (§1.10).
- **Patrón aprovechable.**
  - **Una sola familia con eje de anchura** para todo: condensada y gruesa en
    marcador y minuto, normal en texto, ancha en rótulos.
  - `font-variant-numeric: tabular-nums` en todo lo que cambia (marcador,
    minuto, pares, velocidad, contador de fuentes) para que nada baile.
  - Candidatas verificadas en §6.
- **Enlaces.**
  [Dezeen: Material 3 Expressive](https://www.dezeen.com/2025/05/28/google-ushers-in-age-of-expressive-interfaces-with-material-design-update/) ·
  [Material Design: empezar con M3 Expressive](https://m3.material.io/blog/building-with-m3-expressive)

### 4.3 Color en OKLCH

- **Qué es.**
  - OKLCH (luminosidad, croma, tono) es legible y **perceptualmente uniforme**:
    subir la L sube la claridad de verdad, así que las escalas y los temas
    claro/oscuro se construyen con reglas y no a ojo.
  - Llega a colores P3.
  - La sintaxis de color relativo (`oklch(from var(--x) l c h)`) es Baseline
    ampliamente disponible.
- **Patrón aprovechable.** Derivar en CSS, a partir del color que manda la
  API, versiones de cada color de equipo que siempre se lean (§5):
  `oklch(from var(--equipo) clamp(0.45, l, 0.72) min(c, 0.2) h)`.
- **Enlaces.**
  [Evil Martians: por qué OKLCH](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) ·
  [Selector oklch.com](https://oklch.com/) ·
  [MDN: colores relativos](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_colors/Relative_colors) ·
  [web.dev: temas de color con Baseline](https://web.dev/articles/baseline-in-action-color-theme)

### 4.4 Movimiento con muelles (*springs*) y elementos compartidos

- **Qué es.**
  - **SwiftUI** configura los muelles con dos números, **duración y rebote**
    (de −1 a 1), con los preajustes *smooth*, *snappy* y *bouncy*; son la
    animación por defecto.
  - **Material 3 Expressive** separa muelles **espaciales** (posición, tamaño)
    de muelles de **efectos** (color, opacidad), cada uno con duración rápida,
    normal y lenta, en dos esquemas: *expressive* y *standard*.
  - En **CSS**, `linear()` permite muelles de verdad sin JavaScript. El
    generador de kvin.me usa **los mismos dos parámetros que SwiftUI**
    (duración percibida y rebote).
  - Safari 26 añadió las **animaciones ligadas al scroll**.
- **Patrón aprovechable.**
  - **Tabla de muelles común web ↔ iOS** en duración y rebote (§7, principio 7).
  - Elemento compartido fila de partido → centro de partido (escudos y
    marcador viajan) con View Transitions.
  - Cabecera que se compacta al hacer scroll con `animation-timeline`, sin
    JavaScript.
- **Enlaces.**
  [WWDC23: Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/) ·
  [Material: el sistema de movimiento](https://m3.material.io/styles/motion/overview/how-it-works) ·
  [Chrome: linear()](https://developer.chrome.com/docs/css-ui/css-linear-easing-function) ·
  [Josh W. Comeau: muelles en CSS](https://www.joshwcomeau.com/animation/linear-timing-function/) ·
  [Generador de muelles CSS](https://www.kvin.me/css-springs) ·
  [WebKit: novedades de Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) ·
  [WebKit: guía de animaciones con scroll](https://webkit.org/blog/17101/a-guide-to-scroll-driven-animations-with-just-css/) ·
  [HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)

### 4.5 Estados en vivo y microinteracciones

- **Qué hacen los buenos.** Live Activities y widgets (LaLiga, FotMob, Apple
  Sports, Sofascore) han hecho del "en directo" un estado del sistema: un
  punto que late, el minuto que avanza y el marcador que cambia **una vez**, con
  intención, no en bucle. Los reproductores (YouTube) animan la respuesta a lo
  que tú haces (doble toque, me gusta), no el reposo.
- **Patrón aprovechable.** Solo late lo que está ocurriendo ahora ("en
  directo", "comprobando"). El marcador que cambia se anima una vez. Lo demás
  está quieto.
- **Enlaces.**
  [HIG: Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities)

### 4.6 Accesibilidad (lo que no es tendencia sino suelo)

- **Contraste.** Texto a 4,5:1 (AA) y **3:1 para lo que no es texto**
  (1.4.11), que incluye los puntos de estado de las fuentes.
- **Color.** Nunca como único canal de información (1.4.1).
- **Objetivos táctiles.** WCAG 2.2 pide 24 px como mínimo (2.5.8); aquí se
  usan **44 px**, como pide Apple.
- **Movimiento.** `prefers-reduced-motion` respetado siempre (la 0.6.59 ya lo
  hace).
- **Enlaces.**
  [WCAG 2.2](https://www.w3.org/TR/WCAG22/) ·
  [HIG: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)

---

## 5. Datos que condicionan el diseño

### 5.1 Los colores y escudos de los equipos ya están en la API que usamos

- **Qué da la API.** La API de marcadores de ESPN, que el backend ya consulta
  para `/api/scores`, devuelve por equipo `color`, `alternateColor` y `logo`
  (PNG de 500 px). Petición real de hoy a
  `site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard`:

| Equipo | `color` | En OKLCH | Problema |
|---|---|---|---|
| Real Madrid | `ffffff` | L 1,00 · C 0 | Blanco puro: invisible en tema claro. Hay que tirar de `alternateColor` o de un contorno. |
| Getafe | `0000ff` | L 0,45 · C 0,31 · h 264 | Croma altísimo: chirría como fondo grande; hay que bajar el croma. |
| Atlético de Madrid | `ca3624` | L 0,56 · C 0,19 · **h 31** | Es casi el **rojo de "fallida"**. |
| Real Betis | `288a00` | L 0,56 · C 0,18 · **h 140** | Es casi el **verde de "verificada"**. |
| Málaga | `b9e8f0` | L 0,90 · C 0,05 · h 209 | Casi blanco en tema claro. |

- **Qué implica.**
  1. Los colores de equipo **chocan** con los colores de estado. Regla: el
     color de equipo vive en superficies grandes (fondos, franjas, escudos) y
     el de estado solo en indicadores pequeños que llevan siempre **forma +
     palabra** ("● Verificada", "▲ Floja", "✕ Sin señal"). Nunca un punto de
     color de equipo junto a un punto de estado.
  2. Los colores de equipo se **normalizan en OKLCH** por tema (limitar L y C,
     elegir `alternateColor` si el principal es casi blanco o casi negro).
  3. Hoy la agenda sale de futbolenlatv, EPG de Movistar+ y TheSportsDB, no de
     ESPN; unir escudo y colores a cada partido es trabajo del backend (buscar
     el equipo por nombre normalizado, con la misma lógica de alias de "Para
     ti"). Sin escudo ni color, un **escudo genérico con iniciales** y un tono
     sacado del nombre (la biblioteca ya hace eso con el hash del canal).

### 5.2 Lo que la app ya hace y el diseño debe respetar (de `inventario-front.md`)

- Marcador **tapado** para el partido que estás viendo ("Tu emisión va por
  detrás del directo").
- Resaltado de tus partidos **sin reordenar**.
- Carruseles que **no se recolocan**.
- Toasts: dos como máximo y **nunca sobre el vídeo**.
- Línea de estado bajo el vídeo.
- Deshacer en 6 s.
- Atajos (S para el panel nerd, G para favorito).
- Barra "Sigue sonando".

El diseño nuevo cambia la forma, no estas reglas.

---

## 6. Tipografías candidatas verificadas

- **Cómo se comprobó.**
  - Metadatos de Google Fonts (ejes variables y fecha).
  - TTF variable descargado del repositorio `google/fonts`: **todas** las de
    la tabla viven en `ofl/`, es decir, licencia SIL Open Font License 1.1,
    que permite usarlas en la web y embeberlas en la app de iOS.
  - Lectura con fontTools de la función `tnum` (cifras tabulares), de si las
    cifras ya son de ancho fijo por defecto y de los glifos del español
    (ñ, tildes, ¿, ¡, €, «»). Todas cumplen el español.
- **Peso.** Tamaño del TTF variable completo. Google Fonts sirve WOFF2 por
  subconjuntos, bastante más ligeros; hay que autoalojarlas (la app corre en
  LAN y no debe depender de un CDN).

| Familia | Ejes | `tnum` | Uso propuesto | Notas |
|---|---|---|---|---|
| **Mona Sans** | wdth 75-125 · wght 200-900 | sí | UI + marcador (condensada y gruesa) | Grotesca neutra, de la misma familia estética que SF Pro: buena pareja visual con la app de iOS. 340 KB. |
| **Hubot Sans** | wdth 75-125 · wght 200-900 | sí | Alternativa más técnica a Mona | Hermana de Mona Sans (mismos ejes), más geométrica. |
| **Archivo** | wdth 62-125 · wght 100-900 | sí (+ `zero`, `case`) | Todo en el territorio "Rótulo" | Grotesca de titulares de fines del XIX, de ExtraCondensed a Expanded. 643 KB. |
| **Anybody** | wdth 50-150 · wght 100-900 | sí (+ `zero`) | Titulares y números en "Grada" | Afinidad con Eurostile y los 90 (recuerda a las camisetas de fútbol de esa década). 196 KB. |
| **Science Gothic** | wdth 50-200 · wght · CTRS · slnt | sí (+ `zero`) | Alternativa de titulares | Revival de Bank Gothic con minúsculas. 2,6 MB en TTF: solo con subconjunto. |
| **Onest** | wght 100-900 | sí | Texto de "Grada" | Híbrida geométrica/humanista, clara en tamaños pequeños. |
| **Schibsted Grotesk** | wght 400-900 | sí (+ `zero`) | Texto alternativo | De un grupo de prensa, pensada para interfaces. |
| **Saira** | wdth 50-125 · wght 100-900 | sí (+ `zero`) | Alternativa a Archivo | Más "tecno". |
| **Martian Mono** | wdth 75-112,5 · wght 100-800 | cifras fijas (mono) | Panel nerd de "Cristal" | Monoespaciada con eje de anchura: columnas de datos compactas. |
| **Azeret Mono** | wght 100-900 | sí (+ `zero`) | Panel nerd de "Rótulo" | Inspirada en OCR y sistemas de los 90. |
| **Spline Sans Mono** | wght 300-700 | cifras fijas (mono) | Panel nerd de "Grada" | Tono más suave que las otras dos. |
| **Datatype** | wdth · wght 100-900 | — | Mini-gráficos en el panel nerd (opcional) | Convierte `{l:10,40,25,70}` en una línea de tendencia **con la propia fuente**. 4 MB: solo si se carga al abrir el panel. |
| **Doto** | ROND 0-100 · wght 100-900 | cifras fijas | Acento de videomarcador (opcional) | Matriz de puntos; solo a partir de ~32 px. |

- **Descartadas, y por qué.**
  - **Outfit, Inter, JetBrains Mono**: son las de la 0.6.59.
  - **Big Shoulders**: no tiene `tnum` y sus cifras son proporcionales; el
    marcador "bailaría".
  - **Google Sans Flex** y **TikTok Sans**: tienen licencia libre, pero son
    fuentes de marca de terceros.
  - **Bricolage Grotesque**: muy vista en webs de 2024-2025.
  - **Roboto Flex**: demasiado genérica (es la tipografía de Android).

---

## 7. Síntesis: principios para Ace Player Neo

1. **Lo primero, el partido.** Cada fila de la agenda responde en menos de un
   segundo a tres preguntas, en este orden: ¿qué partido es?, ¿está en
   directo (o cuánto falta)?, ¿hay señal? Lo demás (liga, canales, acciones)
   va en segundo nivel. Orden visual: en directo > próximo > más tarde >
   terminado (este último atenuado, como hoy).
2. **La señal tiene un lenguaje propio y fijo.**
   - Verde = verificada, ámbar = floja, rojo = fallida, anillo hueco que
     late = comprobando, gris hueco = pendiente.
   - Siempre **forma + palabra + color**, con 3:1 de contraste como mínimo
     en los dos temas.
   - Estos colores no se usan para nada más.
   - "En directo" **no** usa el rojo de "fallida": tiene su propia etiqueta,
     su pulso y el color de acento del territorio. Un partido en directo y
     sin señal debe leerse como tal, sin ambigüedad.
3. **Los protagonistas son los equipos.** Escudos grandes y colores de
   equipo en superficies amplias (fondos, franjas, luz ambiental del
   reproductor), normalizados en OKLCH por tema. El color de marca es escaso:
   foco, acción principal y "en directo". Sin escudo, iniciales sobre un tono
   derivado del nombre.
4. **Los números son tipografía de primera.**
   - Marcador, minuto, cuenta atrás, pares y velocidad en cifras tabulares,
     grandes y condensadas, de una familia con eje de anchura.
   - Un número que cambia no mueve nada a su alrededor.
   - Móvil: ≥ 13 px en texto de lectura y ≥ 11 px solo en rótulos terciarios.
5. **El cristal, donde aporta.**
   - Material translúcido solo en la capa que flota (barra inferior,
     mini-reproductor, controles sobre el vídeo, hojas modales), nunca sobre
     cristal y nunca en listas.
   - Sobre listas que se desplazan, casi opaco.
   - Respaldo opaco con "Reducir transparencia" (interruptor propio más la
     consulta de medios donde exista) y sin `backdrop-filter`.
   - En iOS, el cristal del sistema.
6. **Bento con jerarquía, solo en el centro de partido.**
   - Escritorio: vídeo grande; marcador, reloj y fuentes al lado; información
     y panel nerd plegados.
   - Móvil: vídeo fijo arriba y todo lo demás en una pila que se desplaza.
   - Agenda y biblioteca son **listas con ritmo**, no rejillas de tarjetas
     iguales.
7. **Un solo sistema de movimiento, compartido web ↔ iOS.**
   - Muelles con duración y rebote (SwiftUI) y la misma tabla en CSS
     `linear()`: *rápido* 0,25 s / rebote 0 (estados, conmutadores),
     *estándar* 0,4 s / 0,15 (paneles, hojas, elemento compartido), *héroe*
     0,55 s / 0,3 (solo en momentos: gol, entrar al partido).
   - Solo se animan `transform` y `opacity`.
   - Con movimiento reducido: fundidos ≤ 150 ms y ningún pulso (el
     indicador queda fijo).
8. **Late solo lo que está pasando.**
   - Pulso para "en directo" y "comprobando", nada más.
   - El marcador que cambia se anima **una vez**; el que estás viendo sigue
     **tapado** hasta que lo destapes (tu emisión va por detrás).
   - Los avances automáticos de vídeo están prohibidos: cada uno abriría una
     sesión en el motor.
9. **Lo técnico, a un gesto pero fuera de la vista.**
   - Pares, hashes, motor, bitrate, códec y veredictos del comprobador viven
     en el **panel nerd** (tecla S, deslizar o botón), en monoespaciada y con
     una línea de tendencia.
   - En la vista principal, lenguaje humano: "Señal buena", "Floja", "Sin
     señal, reintento a las 21:14".
10. **Móvil a una mano.**
    - Navegación inferior con 4 destinos estables: Agenda, Biblioteca,
      Buscar y Ajustes. Salud y Pegar hash, a un toque desde Ajustes y desde
      el reproductor.
    - Mini-reproductor anclado encima de la barra.
    - Hoja de fuentes con alturas fijas (media y completa).
    - Gestos: deslizar el vídeo hacia abajo para minimizarlo, deslizar la
      tira de fuentes, pulsación larga en un partido para acciones rápidas,
      tirar para actualizar la agenda.
    - Zonas seguras respetadas y objetivos de 44 px.
    - Los caminos de siempre, a uno o dos toques (lección de Plex y Twitch).
11. **El escritorio aprovecha el ancho.** A partir de 1440 px, tres columnas
    a la vez: agenda (≈ 340 px, sigue visible mientras ves), reproductor con
    su bento y panel lateral de fuentes/nerd (≈ 360 px, plegable). El vídeo
    cede ancho (*squeeze-back*) en vez de taparse. Atajos de teclado
    visibles.
12. **Dos temas de verdad.** Tokens semánticos en OKLCH con valores
    **propios** en claro y oscuro (no una inversión), comprobados a AA; los
    colores de equipo y de estado tienen su versión para cada tema. El claro
    se diseña para ver un partido a pleno sol, no como un apaño.

---

## 8. Síntesis: tres territorios visuales

**Base común, fija en los tres.**

- **Colores de estado** (en claro, el punto y el texto tienen tonos distintos
  para llegar a 3:1 y a 4,5:1):

| Estado | Oscuro | Claro (punto) | Claro (texto) |
|---|---|---|---|
| Verificada | `oklch(0.80 0.19 150)` ≈ `#49de78` | `oklch(0.60 0.16 150)` ≈ `#139948` | `oklch(0.47 0.13 150)` ≈ `#006e30` |
| Floja | `oklch(0.84 0.16 80)` ≈ `#ffbe3f` | `oklch(0.64 0.14 66)` ≈ `#c4780b` | `oklch(0.50 0.11 62)` ≈ `#8f520d` |
| Fallida | `oklch(0.70 0.20 27)` ≈ `#ff655a` | `oklch(0.56 0.20 27)` ≈ `#d02c2a` | `oklch(0.50 0.19 27)` ≈ `#b7191c` |
| Comprobando | anillo hueco que late, en el color de texto secundario | ídem | ídem |

- **Contraste medido.** Todos los puntos de estado quedan por encima de 3:1
  sobre los fondos y superficies de los tres territorios. En oscuro, entre
  5,0 y 10,8; en claro, entre 3,1 y 5,2. Los textos de estado, entre 5,6 y
  6,6 en claro.
- **Sin ámbar ni dorado de marca y sin violeta:** el ámbar solo existe como
  estado "floja".

### 8.1 Territorio A · «Cristal» (noche de estadio a través del vidrio)

- **Idea.** La app es una ventana. El vídeo y los colores de los equipos son
  la luz; la interfaz es vidrio que flota delante y se aparta. Es el
  territorio más cercano a iOS 26/27: la app nativa y la web se sienten la
  misma cosa.
- **Por qué es defendible.** Coherencia total con la app de iOS (que usará el
  cristal del sistema), el vídeo nunca queda tapado por barras opacas y el
  color lo ponen los equipos. Riesgo: rendimiento en móvil, que se controla
  con las reglas de §3.2.
- **Paleta** (azul abismo con acento "cielo", sin negro puro):

| Token | Oscuro | Claro |
|---|---|---|
| Fondo | `oklch(0.205 0.04 252)` ≈ `#081829` | `oklch(0.972 0.01 235)` ≈ `#f0f7fc` |
| Superficie | `oklch(0.265 0.04 250)` ≈ `#152738` | `oklch(0.995 0.004 235)` ≈ `#fcfeff` |
| Cristal (sobre desenfoque) | `oklch(0.30 0.04 250 / 0.55)`; opaco de respaldo `#1e2f41` | `oklch(0.99 0.004 235 / 0.6)`; respaldo `#f9fcfe` |
| Texto | `oklch(0.97 0.008 240)` ≈ `#f0f6fa` (16,4:1) | `oklch(0.24 0.04 252)` ≈ `#102032` (15,2:1) |
| Texto secundario | `oklch(0.78 0.03 240)` ≈ `#a7bac9` (9:1) | `oklch(0.48 0.035 250)` ≈ `#4f5f71` (6:1) |
| Acento "cielo" (relleno) | `oklch(0.83 0.12 222)` ≈ `#5fd9ff`, con texto `oklch(0.22 0.05 250)` encima (10,6:1) | el mismo relleno y el mismo texto oscuro encima |
| Acento como texto / "en directo" | `#5fd9ff` (10,9:1) | `oklch(0.50 0.13 245)` ≈ `#0068a5` (5,5:1) |

  El tono 222 queda a 72° del verde de "verificada", para no confundir el
  acento con un estado.

- **Tipografía.**
  - **Mona Sans** para todo: texto a wdth 100; marcador y minuto a wdth 75 y
    wght 800 con `tnum`; titulares a wdth 110.
  - **Martian Mono** en el panel nerd.
  - En iOS, SF Pro con sus anchuras (Compressed/Condensed), que es la misma
    idea.
- **Componentes.**
  - **Móvil:**
    - Barra inferior flotante de cristal con 4 pestañas y el indicador que
      se desplaza como una gota.
    - Mini-reproductor como "accesorio" encima de la barra.
    - Agenda en **franjas** (no tarjetas): hora grande a la izquierda, dos
      escudos grandes y un medidor de señal de 3 barras a la derecha.
    - La fila en directo recibe un velo con los colores de los dos equipos.
  - **Centro de partido:**
    - Vídeo con controles en cápsulas de cristal (patrón YouTube y Apple TV).
    - Debajo, un bento: marcador con los colores de los equipos como luz
      ambiental (patrón Apple Sports), tesela de fuentes con la escala de
      estados y tesela de información.
  - **Selector de fuentes:** hoja con dos alturas.
  - **Panel nerd:** cristal oscuro sobre el vídeo.
  - **Escritorio 1440:** barra lateral de agenda (opaca), escenario central y
    panel de fuentes.
  - **Formas:** esquinas grandes y **concéntricas** (radio exterior 28 →
    interior 28 − margen).
- **Movimiento.**
  - Líquido y con rebote suave (tabla de muelles *estándar*).
  - La cápsula de la pestaña activa se estira hacia la siguiente.
  - Elemento compartido fila → centro de partido (escudos y marcador viajan).
  - Al pulsar, el cristal se "aprieta" (escala 0,97 y brillo).
  - El marcador cambia con giro vertical de cifras y un destello del color
    del equipo que marca.
  - "En directo": anillo que se expande cada 2 s.
- **Icono.**
  - Un círculo central de campo convertido en **lente de cristal** que
    refracta un triángulo de reproducir, sobre azul abismo; brillo en cielo.
  - En capas para Icon Composer: fondo, línea de campo y lente.
  - El símbolo (círculo + triángulo) funciona solo en una tinta, para el
    tintado y para la PWA.

### 8.2 Territorio B · «Rótulo» (realización de televisión, sin ruido)

- **Idea.** La tipografía y la retícula de la tele deportiva. Superficies
  **opacas y planas**, líneas de 1 px, esquinas casi rectas y un sistema de
  color **sin color de marca**: tinta y papel, y el color entra solo con los
  equipos y los estados. El marcador de la tele (*scorebug*) es el componente
  madre: el mismo a tres tamaños (fila, centro de partido, mini-reproductor).
- **Por qué es defendible.** Máxima legibilidad y rendimiento (sin
  desenfoques salvo sobre el vídeo), jerarquía brutalmente clara y una
  personalidad que ninguna app de *streaming* tiene. Es el polo opuesto a
  «Cristal». Riesgo: que se sienta frío; se compensa con la tipografía a
  anchos extremos y con el color de los equipos en franjas.
- **Paleta** (pizarra y papel, monocromo):

| Token | Oscuro ("pizarra") | Claro ("papel") |
|---|---|---|
| Fondo | `oklch(0.235 0.012 250)` ≈ `#1a1f24` | `oklch(0.985 0 0)` ≈ `#fafafa` |
| Superficie | `oklch(0.28 0.012 250)` ≈ `#25292f` | `oklch(1 0 0)` = `#ffffff` |
| Línea | `oklch(0.40 0.012 250)` ≈ `#43484e` | `oklch(0.85 0.004 250)` ≈ `#ccced0` |
| Texto | `oklch(0.975 0.002 250)` ≈ `#f6f7f8` (15,5:1) | `oklch(0.18 0.01 250)` ≈ `#0e1216` (18:1) |
| Texto secundario | `oklch(0.78 0.01 250)` ≈ `#b3b8be` (8,3:1) | `oklch(0.44 0.012 250)` ≈ `#4e5359` (7,4:1) |
| Acción principal / "en directo" | **inversión**: bloque de texto claro con letra de pizarra | bloque de tinta con letra de papel |
| Color | solo equipos (franjas de 4-6 px en los bordes del *scorebug*) y estados | ídem |

- **Tipografía.**
  - **Archivo** para todo: rótulos en versalitas a wdth 125; marcador,
    minuto y horas a wdth 62 y wght 800 con `tnum`; texto a wdth 100.
  - **Azeret Mono** en el panel nerd, y **Datatype** para sus mini-gráficos
    si compensa el peso.
- **Componentes.**
  - **Agenda:** una **parrilla** de emisión con la hora como columna gruesa
    a la izquierda y los partidos como *scorebugs*: franja de color de cada
    equipo, siglas o escudo, marcador y un medidor de señal tipo LED de 3
    segmentos.
  - **Centro de partido:**
    - El vídeo lleva un *scorebug* real en la esquina, que se puede tapar.
    - Las fuentes se ven como un **rack** (tabla densa y alineada: nº,
      proveedor, estado, pares, Mbit/s) al estilo de una mesa de
      realización.
  - **Pestañas:** texto subrayado, no cápsulas.
  - **Mini-reproductor:** una tira *scorebug*.
  - **Escritorio 1440:** "mesa de realización" con agenda-parrilla, monitor
    de programa y rack, más una tira fija arriba con los marcadores en
    directo, que se desplaza a mano y no en bucle.
  - **Formas:** radios de 2-4 px.
- **Movimiento.**
  - El de los grafismos de tele: **barridos y revelados** con máscara
    (`clip-path`, 180-240 ms, muelle *rápido* sin rebote).
  - Los paneles entran deslizando desde su borde.
  - El marcador cambia con **giro de paleta** (*split-flap*) y un subrayado
    del color del equipo que dura 1 s.
  - "En directo": punto fijo junto a una barra fina que se llena con el
    minuto. El único pulso es el de "comprobando".
- **Icono.**
  - Dos barras horizontales apiladas (los dos equipos de un marcador) cuyo
    extremo derecho forma un triángulo de reproducir.
  - Tinta sobre papel (claro), papel sobre pizarra (oscuro).
  - Ya es monocromo, así que el tintado de iOS y la PWA salen solos.

### 8.3 Territorio C · «Grada» (el color lo pone la afición)

- **Idea.** La energía de la grada y de las camisetas de los 90: tipografía
  enorme que se estira y se comprime, bloques de color de los equipos
  partidos en diagonal como un tifo, formas redondas que cambian al tocarlas
  (a la manera de Material 3 Expressive) y un único acento **fucsia
  bengala**. Es el más expresivo y el que más personalidad propia tiene.
- **Por qué es defendible.** Se diferencia de todas las apps de marcadores
  (casi todas azul oscuro) y de las de *streaming* (casi todas negras); da
  alegría a una app de uso diario sin perder la jerarquía, porque el color
  fuerte se reserva al partido destacado y al que suena. Riesgo: cansar; se
  controla limitando los bloques de color a una o dos zonas por pantalla.
- **Paleta** (hormigón cálido y cal con un toque rosado; acento fucsia en
  tono 350, lejos del violeta, que ronda el 300):

| Token | Oscuro ("hormigón de noche") | Claro ("cal") |
|---|---|---|
| Fondo | `oklch(0.225 0.012 15)` ≈ `#211a1a` | `oklch(0.965 0.01 15)` ≈ `#faf1f1` |
| Superficie | `oklch(0.275 0.014 15)` ≈ `#2e2525` | `oklch(0.995 0.003 15)` ≈ `#fefdfd` |
| Texto | `oklch(0.97 0.008 15)` ≈ `#faf3f3` (15,7:1) | `oklch(0.22 0.014 15)` ≈ `#211818` (15,7:1) |
| Texto secundario | `oklch(0.78 0.014 15)` ≈ `#c0b4b4` (8,5:1) | `oklch(0.47 0.016 15)` ≈ `#645758` (6,2:1) |
| Acento fucsia (relleno) | `oklch(0.70 0.23 350)` ≈ `#ff4fb2`, con texto oscuro `oklch(0.2 0.02 350)` encima (6,1:1) | `oklch(0.57 0.23 350)` ≈ `#d0138a`, con texto blanco encima (5:1) |
| Fucsia como texto / "en directo" | `oklch(0.78 0.17 350)` ≈ `#fe8cc5` (8:1) | `oklch(0.53 0.21 350)` ≈ `#bb167c` (5,4:1) |

  El fucsia (350) y el rojo de "fallida" (27) están a 37° de tono: la
  diferencia la cargan la forma y la palabra (principio 2), y este es el
  territorio donde más hay que vigilarlo en la maqueta.

- **Tipografía.**
  - **Anybody** para titulares, marcador y minuto: wdth 50-60 y wght 900 en
    cifras con `tnum`; wdth 130-150 en rótulos de día ("HOY", "MAÑANA").
  - **Onest** para texto e interfaz.
  - **Spline Sans Mono** en el panel nerd.
  - Alternativa de titulares: Science Gothic.
- **Componentes.**
  - **Agenda:**
    - Arriba, **tu partido del día** en un cartel grande con los colores de
      los dos equipos partidos en diagonal y los escudos enormes.
    - Debajo, el resto en filas compactas.
    - La jerarquía la da el tamaño, no una rejilla.
  - **Chips de día y de filtro:** cápsulas que se convierten en *squircle*
    al seleccionarlas.
  - **Centro de partido:**
    - "Tifo" de fondo con los colores de los equipos (con grano estático,
      nada de vídeo).
    - Cifras gigantes.
    - Fuentes como cápsulas con barras de señal.
  - **Mini-reproductor:** píldora partida con los colores de los dos equipos.
  - **Biblioteca:** canales con su inicial gigante sobre el tono del canal.
  - **Escritorio 1440:** "tu jornada" a la izquierda, escenario con marco de
    tifo y cápsulas de fuentes a la derecha.
  - **Formas:** redondas y blandas, con alguna forma M3 (trébol, píldora)
    solo en estados seleccionados.
- **Movimiento.**
  - Expresivo pero medido: muelle *héroe* (rebote 0,3) solo en momentos.
  - **Gol:** el escudo del equipo que marca crece, el tifo se inunda de su
    color durante 1,2 s y vuelve.
  - Los chips cambian de forma al elegirlos.
  - Los números se "estampan" (escala 1,25 → 1 con rebote).
  - "En directo": resplandor de bengala que respira en el fucsia.
  - El resto, muelle *estándar*.
  - Con movimiento reducido todo queda en fundidos.
- **Icono.**
  - Un disco fucsia (la bengala) con un triángulo de reproducir recortado y
    una trama de puntos que se abre como una grada vista desde arriba.
  - En oscuro, disco fucsia sobre hormigón.
  - El símbolo, sin la trama, sirve para el tintado y la PWA.

### 8.4 Por qué los tres se parecen poco

| | «Cristal» | «Rótulo» | «Grada» |
|---|---|---|---|
| Material | Vidrio translúcido flotante | Plano, opaco, líneas de 1 px | Bloques de color sólidos con grano |
| Fondo oscuro | Azul abismo (tono 252) | Pizarra casi neutra | Hormigón cálido rosado (tono 15) |
| Fondo claro | Hielo | Papel blanco | Cal rosada |
| Color de marca | Cielo (222) | Ninguno: tinta/papel | Fucsia bengala (350) |
| Tipografía | Mona Sans (grotesca neutra, pariente de SF) | Archivo (grotesca de titular, de extracondensada a expandida) | Anybody (Eurostile + años 90) con Onest |
| Formas | Grandes y concéntricas | Casi rectas (2-4 px) | Redondas, con cambio de forma al elegir |
| Movimiento | Líquido, rebote suave, elementos compartidos | Barridos y paletas giratorias, sin rebote | Muelles con rebote en momentos, estampados |
| Agenda | Franjas con escudos y medidor de señal | Parrilla de *scorebugs* | Cartel del partido destacado + filas |
| Fuentes | Hoja con escala de estados | Rack tipo mesa de realización | Cápsulas con barras |
| Referentes | Apple TV, Apple Sports, YouTube 2025 | *Scorebugs* de 2025-2026, Sofascore | Material 3 Expressive, Netflix *color feeding*, Plex |

**Lo que queda fuera en los tres:** el casi negro con ámbar/dorado de la
0.6.59, el champán, el violeta y los degradados morados, Outfit + Inter +
JetBrains Mono, la rejilla de tarjetas iguales, los avances de vídeo
automáticos y el rojo como color de "en directo".
