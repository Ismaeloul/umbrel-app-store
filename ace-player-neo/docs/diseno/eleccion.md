# Elección de la dirección visual

> Parada 2.5, hecha en modo autónomo el 23-sep-2026. Tu prompt dice: «elige tú
> la mejor según lo pedido en 2.5, justifícalo en `docs/diseno/eleccion.md` y
> deja las otras dos maquetas guardadas». Esto es esa elección.
> Las tres maquetas siguen intactas en `opcion-A/`, `opcion-B/` y `opcion-C/`.

## La decisión

**Elegida: la opción A, «Luz de focos»** (el territorio «Cristal» de
`referencias.md` §8.1), **con injertos de B y de C** que se listan abajo.

- En puntos, **A y B empatan**: 8,1 frente a 8,0 de media simple, y 8,08 frente
  a 8,10 ponderando según 2.5. C queda claramente detrás (7,0).
- Desempatan tres cosas, las tres sacadas de tu prompt:
  1. La app de iOS **tiene que** llevar Liquid Glass y la «misma dirección
     visual que la web» (FASE 3). A es la única en la que el cristal forma parte
     del lenguaje, no un añadido.
  2. **La mezcla solo funciona en un sentido.** A puede adoptar lo mejor de B
     (parrilla, rack de fuentes, tira de directo, claro de papel) sin dejar de
     ser A. B no puede adoptar el cristal y las formas redondeadas de A sin
     dejar de ser B, porque su identidad es precisamente lo plano y lo recto.
  3. **Lo que ya has rechazado.** En oscuro, B es pizarra neutra sin color de
     marca, la más cercana de las tres al «casi negro» que ya no quieres. A es
     un azul profundo con un acento vivo, que es literalmente una de las
     tendencias que citas: «acentos vivos sobre fondos profundos».
- **El punto flojo de A es la personalidad** (7 de 10): azul oscuro con acento
  frío es la familia de color más vista en las apps de marcadores. Casi todos
  los injertos van a corregir eso.
- **Si mañana prefieres B**, es un plan B de verdad, no un premio de
  consolación: está al mismo nivel y abajo explico qué cambiaría.

---

## Cómo se ha juzgado

- **Material.** Los tres `README.md`, 33 capturas (las pantallas obligatorias
  de cada opción en los dos temas, más los extras de estado vacío, sin
  transparencia e iconos), el HTML de las maquetas para comprobar dos cosas
  concretas (el marcador tapado y las zonas seguras) y tu prompt (§2.2, §2.5,
  FASE 2 y FASE 3).
- **Tres miradas.**
  - *Director de arte* de apps de deporte y *streaming*: personalidad,
    modernidad, jerarquía visual y modo claro.
  - *Experto en usabilidad y accesibilidad móvil*: legibilidad, AA, 44 px,
    pulgar, pliegue y escritorio.
  - *Ingeniero* que la construirá en React y SwiftUI con Liquid Glass:
    coherencia con iOS, rendimiento, datos que hacen falta y riesgo.
- **Pesos.** Salen de 2.5:
  - «lo primero que se ve es qué partidos hay, cuáles en directo y si hay
    señal» → jerarquía, 20 %;
  - «personalidad propia» y «evita lo genérico» → personalidad, 15 %;
  - «la modernidad no está reñida con la usabilidad» → accesibilidad, 15 %;
  - el resto, 10 % o 5 %.
- Las notas son del jurado, no mediciones. Las medidas (contraste, 11 px,
  44 px) son las de cada README; aquí no se han vuelto a medir.

## Puntuaciones

| Criterio | Mirada que más pesa | Peso | A «Luz de focos» | B «Rótulo» | C «Grada» |
|---|---|---|---|---|---|
| Personalidad | Dirección de arte | 15 % | 7 | 8,5 | **9** |
| Jerarquía (partidos, directo y señal primero) | Arte + usabilidad | 20 % | 8,5 | **9** | 6 |
| Modernidad 2026 | Dirección de arte | 10 % | **9** | 7 | 8 |
| Accesibilidad y legibilidad | Usabilidad | 15 % | 8 | **8,5** | 6,5 |
| Móvil | Usabilidad | 10 % | **8** | 7,5 | 6 |
| Escritorio | Usabilidad | 5 % | 8 | 8 | 7,5 |
| Modo claro | Arte + usabilidad | 5 % | 7,5 | **9** | 7,5 |
| Coherencia con iOS (Liquid Glass) | Ingeniería | 10 % | **9,5** | 6,5 | 7 |
| Coste y riesgo (10 = barato y seguro) | Ingeniería | 10 % | 7 | **8** | 5,5 |
| **Media simple** | | | **8,1** | 8,0 | 7,0 |
| **Media ponderada** | | | 8,08 | **8,10** | 6,93 |

---

## Opción A · «Luz de focos»

Capturas:
[agenda en móvil, oscuro](opcion-A/capturas/agenda-movil-oscuro.png) ·
[centro de partido en móvil, claro](opcion-A/capturas/partido-movil-claro.png) ·
[centro de partido en escritorio, oscuro](opcion-A/capturas/partido-escritorio-oscuro.png)

- **Dirección de arte.**
  - Es la que más parece un producto de Apple de 2026: cristal solo en lo que
    flota, esquinas concéntricas y cifras condensadas de Mona Sans.
  - Tiene una firma propia: el minuto dentro del círculo central, que es
    también el icono. Y los escudos se «encienden» solo en directo.
  - Pero el conjunto (azul abismo y cielo) es la paleta más habitual del
    sector. Sin los focos y el anillo, se confundiría con cualquier app de
    marcadores.
- **Usabilidad.**
  - La fila de la agenda contesta en orden, de izquierda a derecha: minuto o
    hora, equipos, señal con palabra. Caben 4 partidos enteros sobre el
    pliegue en 390×844.
  - Las fuentes van en lista vertical con frase humana («funcionó en el
    reproductor», «reintento a las 20:16»).
  - Hay capturas de «sin transparencia» y «sin movimiento».
- **Ingeniería.**
  - Traducción a SwiftUI casi uno a uno: `TabView`, `tabViewBottomAccessory`
    para el mini-reproductor, `GlassEffectContainer`, SF Pro con
    `.fontWidth(.compressed)` y `.navigationTransition(.zoom)`.
  - El riesgo es el desenfoque en Safari de iOS. Está acotado: casi opaco sobre
    listas y desenfoque real solo sobre el vídeo. Pero hay que medirlo en un
    iPhone.
- **Defectos vistos en las capturas** (se corrigen antes de construir, ver
  «Correcciones»):
  - **El cero lleva barra y se lee «Ø».** Se ve en «21:00» y en el 0-0 del
    Galatasaray. Es el cero tabular de Mona Sans a anchura 75.
  - **El partido que estás viendo sale destapado.** En el centro de partido, el
    2-1 del Atlético–Tottenham se ve por defecto. La regla 29 del inventario
    dice que sale tapado hasta que lo pidas. La biblioteca y el mini-reproductor
    sí lo cumplen («Marcador oculto»).
  - **«Comprobando», quieto, parece un medidor lleno en gris.** Pasa con el
    Real Madrid–Bayern de la agenda y con Elcano en la biblioteca de
    escritorio. Se puede leer como «hay señal».
  - **Asoma texto de la lista alrededor de la barra flotante.** Se ve por el
    hueco de debajo de la barra y entre el mini-reproductor y la barra
    («Deportes», «Sin emisión anunciada»). Pasa también
    [sin transparencia](opcion-A/capturas/biblioteca-movil-claro-sin-transparencia.png).
  - En la agenda de escritorio, **media columna derecha queda vacía** bajo el
    escenario.
  - En claro, **fondo y superficie casi no se distinguen** (`#f0f7fc` frente a
    `#fbfeff`): las tarjetas flotan sin borde visible.
  - Las teselas de día del móvil miden unos 85 px de alto y se comen casi una
    fila de partido.
  - **Los halos de pulso de los puntos de directo se salen de su sitio** en la
    biblioteca móvil (58', 72').
  - Muchos rótulos de 11 px en escritorio (teselas de día, carril, acciones de
    la fuente). Cumplen el mínimo, pero allí sobra sitio.
- **Icono.** Círculo central con línea de medio campo y un triángulo de
  reproducir dentro de una lente. Se lee a 60 px y funciona en una sola tinta
  (tintado y PWA). Es el más «fútbol + vídeo» de los tres.

## Opción B · «Rótulo»

Capturas:
[agenda en móvil, claro](opcion-B/capturas/agenda-movil-claro.png) ·
[centro de partido en móvil, oscuro](opcion-B/capturas/partido-movil-oscuro.png) ·
[agenda en escritorio, oscuro](opcion-B/capturas/agenda-escritorio-oscuro.png) ·
[centro de partido en escritorio, claro](opcion-B/capturas/partido-escritorio-claro.png)

- **Dirección de arte.**
  - La idea más redonda de las tres: el rótulo del marcador es a la vez fila,
    botón de ver e icono.
  - El piloto *tally* del directo, la parrilla de programación y el rack de
    realización le dan una personalidad que ninguna app de *streaming* tiene.
  - El claro de papel y tinta es el mejor de las tres.
  - Pero es fría y rectilínea, y en oscuro es pizarra sin color de marca.
- **Usabilidad.**
  - La jerarquía más clara de las tres: el bloque invertido «Directo 76'» salta
    a la vista antes que nada, y la señal va antes que el canal.
  - En escritorio, la tira de directos y la tabla de la agenda (hora, partido,
    canales, señal) son excelentes.
  - En móvil caben 3 partidos sobre el pliegue: las filas son altas.
- **Ingeniería.**
  - Es la más barata de pintar: plano, opaco y un solo desenfoque, el del
    vídeo.
  - El rótulo en Live Activities y en la isla dinámica encaja mejor que en
    ninguna otra.
  - Pero en iOS el cristal del sistema (barra de pestañas, hojas, controles) se
    posaría sobre un mundo de esquinas de 2-4 px y bloques invertidos: dos
    lenguajes en la misma pantalla.
  - Las chapas con el dibujo de la camiseta necesitan un dato (rayas, franjas,
    mitades) que no da ninguna API que usemos. ESPN da `color` y
    `alternateColor`, no el dibujo.
- **Defectos vistos en las capturas.**
  - **El marcador del partido que ves sale en cuatro sitios a la vez** en el
    centro de partido de escritorio: tira de arriba, cabecera, rótulo sobre el
    vídeo y columna de agenda. Sale destapado en la tira, en el
    mini-reproductor y en la biblioteca («SEV 1 1 BET») mientras la línea de
    estado dice «Vas 34 s por detrás del directo». Eso rompe la regla 29.
  - **En el centro de partido de escritorio, el vídeo queda pequeño** (unos
    636×356) y empujado debajo de la cabecera del marcador.
  - **«Fallida» enciende un segmento rojo**, y un segmento encendido se lee como
    «un poco de señal».
  - **La barra inferior es opaca al 96 % y sin desenfoque**, así que deja ver el
    texto de debajo («Lince», «Floja», «Tauro») justo detrás de sus rótulos.
  - La franja roja de «tu equipo» (Athletic, en la Champions) se confunde con
    el rojo de error.
  - La fila de acciones del móvil aparece cortada a la derecha («Pegar hash» y
    un botón partido).
  - Las marcas de zona segura junto al vídeo de escritorio parecen restos de
    maquetación.
- **Icono.** Dos barras con punta, en monocromo. Es muy sólido en tintado y en
  la PWA, pero a 60 px se lee más como una flecha o una plumilla que como un
  marcador.

## Opción C · «Grada»

Capturas:
[agenda en móvil, oscuro](opcion-C/capturas/agenda-movil-oscuro.png) ·
[centro de partido en móvil, claro](opcion-C/capturas/partido-movil-claro.png) ·
[centro de partido en escritorio, oscuro](opcion-C/capturas/partido-escritorio-oscuro.png)

- **Dirección de arte.**
  - La más valiente y la que más huele a fútbol: tifo partido en diagonal,
    chapas de camiseta, dorsales de canal y titulares enormes de Anybody.
  - Pero roza lo caricaturesco (el botón de pausa festoneado en forma de
    corona), y el fucsia (tono 350) es vecino del violeta que ya rechazaste.
- **Usabilidad.**
  - Es la que peor contesta a «qué partidos hay». En móvil, sobre el pliegue
    solo cabe **un** partido entero, el del cartel: el título «Hoy» gigante y
    los chips de día se comen el resto.
  - Las fuentes van en carrusel horizontal y solo se ven 2 de 11. Las fallidas
    quedan fuera de la vista.
  - Lo bueno: en las filas, la señal va antes que el canal.
- **Ingeniería.**
  - Tres familias tipográficas (Anybody, Onest y Spline Sans Mono), cambio de
    forma en los chips y el tifo pintado con la camiseta de cada club.
  - Sin el dibujo de la camiseta (mismo problema que en B), el tifo se queda en
    dos mitades lisas en la app real.
  - Anybody con Dynamic Type en iOS da trabajo extra.
- **Defectos vistos en las capturas.**
  - **A anchura 55, el cero de Anybody es una cápsula estrecha que parece una
    «I»** (el Getafe–Osasuna 0-0 de la agenda).
  - **La pausa festoneada y el −30 ocupan el centro del vídeo** y tapan el
    juego.
  - **El mini-reproductor enseña «Barça 2-1 Villarreal, 83'» del partido que
    suena** (regla 29).
  - En la agenda de escritorio, **el cartel ocupa 560×590 px** y la lista solo
    enseña 5 partidos.
  - «Ace Player Neo» encima de un título gigante en cada pantalla de móvil.
- **Icono.** Disco fucsia con un triángulo de reproducir y anillos de puntos.
  En tintado queda un «play» genérico, y la grada no se reconoce a tamaño de
  icono.

---

## Por qué A, punto por punto de 2.5

| Lo que pide 2.5 | Cómo lo cumple A (con los injertos) |
|---|---|
| Moderna, tendencias 2026, al nivel de las mejores apps de deporte y *streaming* | Es la única que recoge las siete tendencias que citas: cristal, bento en el centro de partido, tipografía variable con cifras tabulares, OKLCH con acento vivo sobre fondo profundo, colores de equipo como luz, muelles con elemento compartido y estados en vivo. Sus referentes directos son Apple Sports, Apple TV y el reproductor de YouTube de 2025. |
| Jerarquía: qué partidos, cuáles en directo, si hay señal | La fila se lee en ese orden. El directo tiene tres señales (anillo, minuto y palabra) y la señal tiene medidor y palabra. Con los injertos de B (teselas de día compactas, «Sin señal · reintento» en la fila y tira de directos en escritorio) sube al nivel de B. |
| Lo técnico en el panel «nerd» | Pares, bajada, códec y hash solo en «Datos técnicos» (tecla S). En la vista, frases como «Fuente 1 verificada. Vas en directo.» |
| Nada genérico ni gradientes morados; nada de tarjetas iguales | Ni violeta ni dorado. Franjas por competición, no rejilla. La personalidad sale del fútbol (círculo central, focos y colores de club). Es su punto flojo y por eso los injertos de C (dorsales, «Emitiendo ahora», el momento de gol) van a darle carácter. |
| AA, ≥ 11 px, ≥ 44 px, reducir movimiento y transparencia | Medido y comprobado por script en su README, con capturas de «sin transparencia» y «sin movimiento». Los fallos que se ven (el cero con barra, «comprobando» y el hueco de la barra) tienen arreglo sencillo. |
| 60 fps en móvil | Riesgo real pero acotado: casi opaco sobre listas, desenfoque solo sobre el vídeo y respaldo opaco ya hecho. Se mide en iPhone en la Fase 2. |
| Oscuro y claro de verdad | Los dos tienen valores propios. El claro necesita más separación entre fondo y superficie (injerto B6). |
| Móvil con navegación inferior; escritorio con agenda, reproductor y panel a la vez | Barra flotante con 4 destinos y mini-reproductor encima. En escritorio: carril, agenda, escenario y panel lateral plegable que devuelve el ancho al vídeo. |
| Coherencia web ↔ iOS con Liquid Glass | La mejor de las tres: la web copia las reglas del cristal del sistema y la app usa el de verdad. |
| Icono nuevo claro, oscuro y tintado | Tres variantes; el símbolo funciona en una tinta. |

## Injertos: qué se coge de B y de C

| # | De | Qué | Dónde entra en A |
|---|---|---|---|
| B1 | B | **Tira de directos** fija arriba en escritorio: marcadores en vivo y «Luego». Se desplaza a mano, nunca en bucle, y el partido que ves va tapado también ahí. | Agenda y centro de partido desde 1280 px. |
| B2 | B | **Rack de fuentes**: columnas alineadas (Nº, proveedor, estado, pares y Mbit/s) con cifras tabulares. | Panel lateral de escritorio. En móvil sigue la lista con frase humana de A. |
| B3 | B | **Chips de canal** con borde continuo si el canal está en tu biblioteca y discontinuo si se buscará al reproducir. | Fila de agenda y «Dónde se emite». |
| B4 | B | **Botón «Directo» con dos estados**: relleno si vas en el borde; con contorno y «Ir al directo · −34 s» si te has quedado atrás. | Controles del reproductor. |
| B5 | B | **Tapado con barras de censura** y cifras que giran como una paleta al destapar. | Marcador del centro de partido, escenario y tira de directos. |
| B6 | B | **Claro de «papel»**: fondo un escalón más oscuro que las superficies y bordes de control con una línea fuerte de al menos 3:1. | Tokens del tema claro. |
| B7 | B | **«Sin señal · reintento 20:51» en la propia fila** de la agenda. | Columna de señal de la fila. |
| B8 | B | **Día en una línea** («Hoy 23 · 8 partidos»), en vez de teselas de 85 px. | Tira de días en móvil. |
| C1 | C | **«Emitiendo ahora»** arriba de la biblioteca: los canales tuyos que están dando un partido, con el minuto. Tus favoritos siguen debajo **sin reordenarse**. | Biblioteca, móvil y escritorio. |
| C2 | C | **Dorsales de canal**: número o inicial grande y recortada sobre el tono del canal, con la regla de tonos de C (fuera de 280-320, violeta; 140-160, verde de estado; y 15-40, rojo de estado). | Sustituye a los cuadrados de dos letras de A. |
| C3 | C | **Momento de gol**: el escudo del que marca crece y los focos se inundan de su color durante 1,2 s. Con movimiento reducido, solo un fundido de color. | Centro de partido y escenario. |
| C4 | C | **Glifos de estado ● ▲ ✕ ○** con palabra donde no cabe el medidor de barras. | Live Activity, isla dinámica, notificaciones y chips compactos. |

## Correcciones obligatorias a A antes de construir

1. **Cero sin barra** en las cifras de marcador, minuto y hora.
   - Comprobar con fontTools qué función de Mona Sans da el cero con barra y
     desactivarla.
   - Si el glifo tabular lo trae de serie, buscar un alternativo o cambiar la
     familia solo en las cifras, verificándola igual que en `referencias.md`
     §6.
2. **El partido que ves, tapado por defecto** en todos los sitios donde sale:
   centro de partido, escenario, tira de directos, biblioteca y
   mini-reproductor. Se destapa con un toque y sigue destapado hasta cambiar de
   canal o detener (inventario §3.6 y regla 29).
3. **«Comprobando» siempre hueco**, con relleno secuencial. Con movimiento
   reducido, segmentos discontinuos (como B), para que no se confunda con un
   medidor lleno.
4. **Nada de texto asomando alrededor de la barra flotante**: un velo inferior
   que funda la lista antes de la barra, o la barra pegada al borde con la zona
   segura dentro.
5. **Rellenar el hueco del escritorio**: bajo el escenario, «Luego» (los
   próximos partidos con su señal), o el escenario fijo mientras la lista
   corre.
6. **Halos de pulso** contenidos en su caja (sin `overflow` visible fuera de la
   fila).
7. **12-13 px en escritorio** donde hoy hay 11 y sobra sitio (teselas de día,
   carril y acciones de la fuente). En móvil se queda el mínimo de 11 solo para
   rótulos terciarios.
8. **Radio concéntrico** en la fuente activa del selector: la barra izquierda
   de 4 px y la esquina redondeada no casan.

## Qué se descarta y por qué

- **De B:**
  - el lenguaje recto de 2-4 px y la inversión como sistema global: chocan con
    el Liquid Glass de iOS 26/27;
  - la ausencia de color de marca: en oscuro deja la app en pizarra casi negra;
  - el marcador repetido cuatro veces en el centro de partido;
  - el vídeo empujado bajo la cabecera en escritorio;
  - «fallida» con un segmento encendido;
  - las chapas de camiseta en lugar de escudos, por el dato que no tenemos.
- **De C:**
  - el cartel como primer bloque de la agenda móvil;
  - el fucsia como color de marca;
  - la pausa festoneada en el centro del vídeo;
  - las fuentes en carrusel horizontal;
  - Anybody para las cifras;
  - el título gigante y el nombre de la app en cada pantalla;
  - la tercera familia tipográfica.
- **De A:**
  - las teselas de día grandes del móvil (se sustituyen por B8);
  - los cuadrados de dos letras de la biblioteca (se sustituyen por C2).

## Riesgos de la elección y cómo se vigilan

- **Cristal y 60 fps en Safari de iOS.**
  - Medir en un iPhone real en la Fase 2: agenda de 60 filas con
    desplazamiento rápido, y vídeo con los controles visibles.
  - Límite: 2-3 capas desenfocadas visibles a la vez.
  - Si baja de 60 fps, la barra y el mini-reproductor pasan a su respaldo opaco,
    que ya existe.
- **Que se quede en «otra app azul».**
  - Si al construir se ve genérica, la palanca es subir la luz de los equipos
    (focos y halos, sobre todo en claro), **no** añadir un color de marca.
  - Los injertos C1 a C3 existen para esto.
- **Los colores de equipo dependen del backend.**
  - La agenda sale de futbolenlatv, Movistar+ y TheSportsDB, y el color y el
    escudo vienen de ESPN.
  - Si pocos partidos quedan emparejados, A pierde su luz. Hay que medir la
    cobertura en la Fase 2. Sin datos, escudo genérico con iniciales y un tono
    sacado del nombre.
- **Equipos azules frente al acento cielo** (Getafe, Chelsea, Real Sociedad).
  El directo nunca se marca solo con color: siempre anillo, minuto y «En
  directo».
- **El claro es más tranquilo que el oscuro.** Está hecho a propósito (se lee a
  pleno sol). B6 le da la separación que le falta.
- **Peso de las fuentes.** Mona Sans en WOFF2 con subconjunto latino y solo los
  ejes usados. Martian Mono se carga al abrir «Datos técnicos».

## Si mañana prefieres otra

- **No se ha borrado nada.** `opcion-B/` y `opcion-C/` quedan tal cual, con su
  README, su HTML, sus tokens, sus iconos y sus capturas.
- **Regla para la Fase 2, para que cambiar sea barato.**
  - La estética vive en dos capas: tokens semánticos (color, tipo, formas,
    muelles) en un fichero, y componentes de presentación sin lógica.
  - Datos, reproductor, comprobador y estados de fuente no saben nada del
    aspecto.
  - Las tres opciones comparten la misma anatomía: fila de agenda (tiempo,
    equipos, señal), marcador a tres tamaños, medidor de señal, lista o rack de
    fuentes, línea de estado, panel técnico, barra inferior y carril, y
    mini-reproductor.
  - Cambiar de dirección es cambiar los tokens y la piel de esos ocho
    componentes. No hay que tocar las vistas ni la lógica.
- **Si eliges B.**
  - Cambian los tokens (pizarra y papel), la tipografía (Archivo más Azeret
    Mono), el rótulo con punta, el rack, la inversión como acción principal y
    el cristal, que queda solo sobre el vídeo.
  - Antes hay que arreglarle a B:
    - el tapado (regla 29);
    - la barra inferior opaca del todo;
    - que «fallida» no encienda ningún segmento;
    - el tamaño del vídeo en escritorio.
  - En iOS, el cristal del sistema se quedaría en barras, hojas y controles, y
    todo lo demás sería opaco.
- **Si eliges C.**
  - Antes hay que arreglarle:
    - el pliegue de la agenda (el cartel, compacto, o debajo de los directos);
    - las fuentes en lista vertical;
    - una pausa normal;
    - otra fuente para las cifras;
    - el fucsia (confirmar que te gusta a pantalla completa, en claro y en
      oscuro).
- **Si quieres otra mezcla**, por ejemplo «el contenido de B con el cromo de
  A»: rótulos y parrilla en listas y centro de partido, y cristal y formas
  redondeadas en navegación, reproductor y hojas. Basta con decirlo en una
  frase; los tokens de B ya existen.
- **Cómo pedirlo:** «cambia la dirección a la B» (o a la C, o a la mezcla que
  quieras). Para comparar lado a lado, las capturas de las tres están en
  `opcion-*/capturas/` con los mismos nombres de pantalla, tamaño y tema.

> **Confirmado por Isma** (23-sep-2026, 07:45, tras ver las capturas de A, B y C): se queda la **A «Luz de focos»**.
